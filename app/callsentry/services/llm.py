"""LLM access with a local-first provider chain.

Local  : Ollama (llama3.2)      - free, runs on your box
Cloud  : Claude Sonnet 5        - paid fallback, only when LOCAL_ONLY=0
Mock   : canned safe responses  - so a dead model never drops a live call

Latency notes for the realtime voice path
-----------------------------------------
Claude Sonnet 5 runs *adaptive thinking by default* when the `thinking` field
is omitted. On a phone call that is the wrong trade: thinking tokens are
generated before any text, which shows up to the caller as dead air. Every
realtime turn therefore passes `thinking={"type": "disabled"}` explicitly and
`effort: "low"`. Offline work (summaries, sentiment) leaves thinking on.

Sonnet 5 also rejects non-default `temperature`/`top_p`/`top_k` with a 400 -
do not add them back. Steer tone through the system prompt instead.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import httpx
import structlog

from callsentry.config import get_settings
from callsentry.core.providers import Attempt, Component, ProviderSpec, get_registry

log = structlog.get_logger(__name__)

# Claude Sonnet 5 list pricing, USD per million tokens.
CLAUDE_INPUT_PER_MTOK = 3.00
CLAUDE_OUTPUT_PER_MTOK = 15.00

# Hard ceiling on a spoken turn. Roughly 45 seconds of speech - long enough
# for a real answer, short enough that a runaway generation cannot monologue
# at a caller.
REALTIME_MAX_TOKENS = 300
OFFLINE_MAX_TOKENS = 1024


@dataclass
class LLMResult:
    text: str
    provider: str
    tier: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    refused: bool = False
    model: str = ""
    attempts: list[Attempt] = field(default_factory=list)

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class LLMService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.registry = get_registry()
        self._anthropic: Any = None
        self._openai_client: Any = None

    def _claude(self) -> Any:
        if self._anthropic is None:
            from anthropic import AsyncAnthropic

            self._anthropic = AsyncAnthropic(api_key=self.settings.claude_api_key)
        return self._anthropic

    # -- providers ----------------------------------------------------------

    async def _via_ollama(
        self,
        system: str,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        json_schema: dict[str, Any] | None,
    ) -> LLMResult:
        payload: dict[str, Any] = {
            "model": self.settings.ollama_model,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": False,
            "options": {"num_predict": max_tokens},
        }
        if json_schema is not None:
            # Ollama constrains generation to a JSON schema when given one.
            payload["format"] = json_schema

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{self.settings.ollama_base_url}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()

        return LLMResult(
            text=data.get("message", {}).get("content", "").strip(),
            provider="ollama",
            tier="local",
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            cost_usd=0.0,
        )

    async def _via_claude(
        self,
        system: str,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        json_schema: dict[str, Any] | None,
        realtime: bool,
    ) -> LLMResult:
        kwargs: dict[str, Any] = {
            "model": self.settings.claude_model,
            "max_tokens": max_tokens,
            # Cache the system prompt: it carries the business persona and,
            # for KB answers, the retrieved chunks. Identical across turns of
            # a call, so every turn after the first reads at ~0.1x.
            "system": [
                {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
            ],
            "messages": messages,
        }

        if realtime:
            # See module docstring: thinking must be off on the voice path.
            kwargs["thinking"] = {"type": "disabled"}
            kwargs["output_config"] = {"effort": "low"}
        else:
            kwargs["thinking"] = {"type": "adaptive"}
            kwargs["output_config"] = {"effort": "medium"}

        if json_schema is not None:
            cfg = kwargs.setdefault("output_config", {})
            cfg["format"] = {"type": "json_schema", "schema": json_schema}

        resp = await self._claude().messages.create(**kwargs)

        # Sonnet 5 can decline via a 200 with stop_reason "refusal"; content
        # is empty or partial. Check before touching content[0].
        if resp.stop_reason == "refusal":
            log.warning("llm.claude_refused", category=getattr(resp.stop_details, "category", None))
            return LLMResult(
                text="",
                provider="claude",
                tier="cloud",
                input_tokens=resp.usage.input_tokens,
                output_tokens=resp.usage.output_tokens,
                refused=True,
            )

        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        cost = (
            resp.usage.input_tokens / 1_000_000 * CLAUDE_INPUT_PER_MTOK
            + resp.usage.output_tokens / 1_000_000 * CLAUDE_OUTPUT_PER_MTOK
        )
        return LLMResult(
            text=text,
            provider="claude",
            tier="cloud",
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            cost_usd=round(cost, 6),
        )

    async def _via_mock(self, json_schema: dict[str, Any] | None) -> LLMResult:
        # The mock must return something the caller can act on. For schema
        # requests that means a valid-but-neutral object; for prose it means
        # a line that hands off to a human rather than inventing an answer.
        if json_schema is not None:
            text = json.dumps(
                {"intent": "escalate", "confidence": 0.0, "reason": "llm_unavailable"}
            )
        else:
            text = (
                "I'm having trouble with that right now. "
                "Let me take a message and have someone call you back."
            )
        return LLMResult(text=text, provider="mock-llm", tier="mock")

    # -- public -------------------------------------------------------------

    async def complete(
        self,
        system: str,
        messages: list[dict[str, str]],
        *,
        realtime: bool = True,
        max_tokens: int | None = None,
        json_schema: dict[str, Any] | None = None,
    ) -> LLMResult:
        """Run one completion through the provider chain.

        `realtime=True` tunes for a live phone turn (no thinking, low effort,
        short output). Set it False for post-call summarisation.
        """
        limit = max_tokens or (REALTIME_MAX_TOKENS if realtime else OFFLINE_MAX_TOKENS)
        attempts: list[Attempt] = []

        async def ollama(_: ProviderSpec) -> LLMResult:
            return await self._via_ollama(
                system, messages, max_tokens=limit, json_schema=json_schema
            )

        async def claude(_: ProviderSpec) -> LLMResult:
            return await self._via_claude(
                system, messages, max_tokens=limit, json_schema=json_schema, realtime=realtime
            )

        async def mock(_: ProviderSpec) -> LLMResult:
            return await self._via_mock(json_schema)

        # On a live call a small local model is slower than the round trip to
        # Claude on this hardware, so conversation prefers the cloud tier.
        order = (
            ["claude", "ollama", "mock-llm"]
            if realtime and self.settings.voice_prefer_cloud
            else None
        )
        result, _spec = await self.registry.run(
            Component.LLM,
            {"ollama": ollama, "claude": claude, "mock-llm": mock},
            attempts=attempts,
            order=order,
        )
        result.attempts = attempts
        return result

    async def complete_json(
        self,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, Any],
        *,
        realtime: bool = True,
    ) -> tuple[dict[str, Any], LLMResult]:
        """Completion constrained to a JSON schema, with a parse-failure guard."""
        result = await self.complete(
            system, messages, realtime=realtime, json_schema=schema, max_tokens=512
        )
        try:
            parsed = json.loads(result.text)
            if not isinstance(parsed, dict):
                raise ValueError("expected a JSON object")
            return parsed, result
        except (json.JSONDecodeError, ValueError) as exc:
            # A model that ignored the schema is a soft failure, not a crash.
            log.warning("llm.json_parse_failed", provider=result.provider, error=str(exc))
            return {}, result


    async def analyse_json(
        self,
        system: str,
        user: str,
        schema: dict[str, Any],
        *,
        effort: str = "high",
        max_tokens: int = 32_000,
        model: str | None = None,
    ) -> tuple[dict[str, Any], LLMResult]:
        """Schema-constrained offline analysis on a Claude or OpenAI model.

        Cloud only. A small local model grading a twenty-minute sales call
        produces plausible, wrong scores - worse than no score - so there is
        no local or mock tier: if the provider is unavailable this raises
        ProviderUnavailable and the caller marks the call as failed.

        Streams because long transcripts with adaptive thinking can outlast a
        non-streaming HTTP timeout.
        """
        attempts: list[Attempt] = []
        model = model or self.settings.call_intel_model
        provider = provider_for(model)

        async def claude(_: ProviderSpec) -> LLMResult:
            return await self._claude_analysis(
                system, user, schema, effort=effort, max_tokens=max_tokens, model=model
            )

        async def openai(_: ProviderSpec) -> LLMResult:
            return await self._openai_analysis(
                system, user, schema, effort=effort, max_tokens=max_tokens, model=model
            )

        handlers = {"claude": claude, "openai": openai}
        result, _spec = await self.registry.run(
            Component.LLM, {provider: handlers[provider]}, attempts=attempts, order=[provider]
        )
        result.model = model
        result.attempts = attempts
        if result.refused:
            return {}, result
        try:
            parsed = json.loads(result.text)
        except json.JSONDecodeError as exc:
            log.warning("llm.analysis_parse_failed", error=str(exc))
            return {}, result
        return (parsed if isinstance(parsed, dict) else {}), result

    async def _claude_analysis(
        self,
        system: str,
        user: str,
        schema: dict[str, Any],
        *,
        effort: str,
        max_tokens: int,
        model: str,
    ) -> LLMResult:
        extra: dict[str, Any] = {}
        if model.startswith(("claude-opus-5", "claude-fable-5")):
            # Re-run on a fallback model if a safety classifier declines.
            extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        async with self._claude().beta.messages.stream(
            model=model,
            max_tokens=max_tokens,
            # The rubric system prompt is identical for every call scored on
            # the same scorecard, so it is cached across the whole batch.
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            thinking={"type": "adaptive"},
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": schema},
            },
            **extra,
        ) as stream:
            resp = await stream.get_final_message()

        usage = resp.usage
        price_in, price_out = ANALYSIS_PRICES.get(model, (CLAUDE_INPUT_PER_MTOK,
                                                          CLAUDE_OUTPUT_PER_MTOK))
        cost = (
            (usage.input_tokens + (usage.cache_creation_input_tokens or 0) * 1.25
             + (usage.cache_read_input_tokens or 0) * 0.1) / 1_000_000 * price_in
            + usage.output_tokens / 1_000_000 * price_out
        )
        if resp.stop_reason == "refusal":
            log.warning("llm.analysis_refused",
                        category=getattr(resp.stop_details, "category", None))
            return LLMResult(text="", provider="claude", tier="cloud",
                             input_tokens=usage.input_tokens,
                             output_tokens=usage.output_tokens,
                             cost_usd=round(cost, 6), refused=True)
        if resp.stop_reason == "max_tokens":
            raise RuntimeError("analysis hit max_tokens before finishing")

        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        return LLMResult(
            text=text,
            provider="claude",
            tier="cloud",
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cost_usd=round(cost, 6),
        )


    def _openai(self) -> Any:
        if self._openai_client is None:
            from openai import AsyncOpenAI

            self._openai_client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        return self._openai_client

    async def _openai_analysis(
        self,
        system: str,
        user: str,
        schema: dict[str, Any],
        *,
        effort: str,
        max_tokens: int,
        model: str,
    ) -> LLMResult:
        from openai import BadRequestError

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "analysis", "strict": True, "schema": schema},
            },
            "max_completion_tokens": max_tokens,
            "reasoning_effort": OPENAI_EFFORT.get(effort, "medium"),
        }
        try:
            resp = await self._openai().chat.completions.create(**kwargs)
        except BadRequestError as exc:
            # Non-reasoning models reject the effort parameter; retry without it.
            if "reasoning_effort" not in str(exc):
                raise
            kwargs.pop("reasoning_effort")
            resp = await self._openai().chat.completions.create(**kwargs)

        choice = resp.choices[0]
        usage = resp.usage
        tokens_in = usage.prompt_tokens if usage else 0
        tokens_out = usage.completion_tokens if usage else 0
        price_in, price_out = openai_price(model)
        cost = tokens_in / 1_000_000 * price_in + tokens_out / 1_000_000 * price_out
        refused = bool(getattr(choice.message, "refusal", None))
        if choice.finish_reason == "length":
            raise RuntimeError("analysis hit max_tokens before finishing")
        return LLMResult(
            text="" if refused else (choice.message.content or "").strip(),
            provider="openai",
            tier="cloud",
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            cost_usd=round(cost, 6),
            refused=refused,
        )

    async def list_models(self) -> dict[str, Any]:
        """Models each configured provider offers right now, newest first."""
        out: dict[str, Any] = {"anthropic": [], "openai": [], "errors": {}}
        if self.settings.claude_api_key:
            try:
                page = await self._claude().models.list(limit=100)
                models = [m async for m in page]
                models.sort(key=lambda m: m.created_at, reverse=True)
                out["anthropic"] = [{"id": m.id, "name": m.display_name} for m in models]
            except Exception as exc:  # noqa: BLE001 - shown next to the picker
                out["errors"]["anthropic"] = str(exc)[:200]
        if self.settings.openai_api_key:
            try:
                page = await self._openai().models.list()
                models = [m async for m in page if is_openai_text_model(m.id)]
                models.sort(key=lambda m: m.created, reverse=True)
                out["openai"] = [{"id": m.id, "name": m.id} for m in models]
            except Exception as exc:  # noqa: BLE001
                out["errors"]["openai"] = str(exc)[:200]
        return out


def provider_for(model: str) -> str:
    """Anthropic model ids start with "claude"; everything else is OpenAI."""
    return "claude" if model.startswith("claude") else "openai"


_OPENAI_EXCLUDE = (
    "audio", "realtime", "transcribe", "tts", "image", "embedding", "search",
    "moderation", "dall-e", "whisper", "davinci", "babbage", "instruct", "codex",
    "computer-use", "deep-research", "live",
)


def is_openai_text_model(model_id: str) -> bool:
    lowered = model_id.lower()
    if any(word in lowered for word in _OPENAI_EXCLUDE):
        return False
    return lowered.startswith(("gpt-", "chatgpt-")) or (
        len(lowered) > 1 and lowered[0] == "o" and lowered[1].isdigit()
    )


OPENAI_EFFORT = {"low": "low", "medium": "medium", "high": "high", "xhigh": "high", "max": "high"}

# USD per million tokens (input, output). Unlisted models are costed at a
# deliberately high rate so the spending cap errs on the safe side.
OPENAI_PRICES: dict[str, tuple[float, float]] = {
    "gpt-5-mini": (0.25, 2.00),
    "gpt-5-nano": (0.05, 0.40),
    "gpt-5": (1.25, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
}
OPENAI_FALLBACK_PRICE = (5.00, 30.00)


def openai_price(model: str) -> tuple[float, float]:
    # Longest matching prefix, so "gpt-5-mini-2026..." is not priced as "gpt-5".
    for prefix in sorted(OPENAI_PRICES, key=len, reverse=True):
        if model.startswith(prefix):
            return OPENAI_PRICES[prefix]
    return OPENAI_FALLBACK_PRICE


# USD per million tokens (input, output) for the call-intelligence model.
ANALYSIS_PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5": (5.00, 25.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-fable-5-1": (10.00, 50.00),
}


_service: LLMService | None = None


def get_llm() -> LLMService:
    global _service
    if _service is None:
        _service = LLMService()
    return _service
