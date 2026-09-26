"""Grounded FAQ answering over the business knowledge base.

Two guards keep this from fabricating:

1. Retrieval gate  - if the best chunk scores below the confidence threshold,
   we never even ask the model. There is nothing to ground an answer in, so
   the agent escalates.
2. Abstention token - the prompt instructs the model to emit INSUFFICIENT
   when the retrieved text doesn't contain the answer, and we translate that
   into an escalation rather than passing it to the caller.

Prices are additionally gated: quoting a number that isn't in the documents
is the single most damaging thing a receptionist can do.

A small knowledge base (a typical FAQ) is given to the model whole instead of
retrieved: nothing can be missed by a weak retrieval, and no embedding model
is needed. The abstention rule is the guard in both modes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.config import get_settings
from callsentry.services import kb
from callsentry.services.llm import LLMResult, get_llm

log = structlog.get_logger(__name__)

ABSTAIN = "INSUFFICIENT"

SYSTEM_TEMPLATE = """You are the receptionist for {business_name}, answering a question
on a live phone call.

Answer ONLY from the reference material below. It is the complete set of facts
you are permitted to state.

Hard rules:
- If the reference material does not contain the answer, reply with exactly:
  {abstain}
- Never state a price, discount, or fee that does not appear verbatim below.
- Never invent hours, addresses, names, or policies.
- Do not mention "the documents", "the reference material", or that you are
  searching anything. Just answer as the receptionist would.

Style - this is spoken aloud on a phone call:
- Answer the caller's actual question first, directly (yes or no when it is a
  yes/no question), then stop. At most two short sentences, under 40 words.
- Say only what was asked. Do not recite service details, and only mention a
  price when the caller asks what something costs.
- End with at most one question, such as offering to book a technician.
- The conversation so far is included; do not repeat what you already said.
- No lists, no markdown, no URLs. Use plain spoken numbers.
{style}
--- REFERENCE MATERIAL ---
{context}
--- END REFERENCE MATERIAL ---"""


@dataclass
class KBAnswer:
    answered: bool
    text: str
    confidence: float
    sources: list[str] = field(default_factory=list)
    llm: LLMResult | None = None


async def answer(
    session: AsyncSession,
    *,
    business_id: str,
    business_name: str,
    question: str,
    history: list[dict[str, str]] | None = None,
    style: str = "",
) -> KBAnswer:
    import uuid as _uuid

    settings = get_settings()
    whole = await _small_kb(session, _uuid.UUID(business_id))
    if whole is not None:
        return await _answer_from(whole, business_name=business_name, question=question,
                                  history=history, style=style)

    hits = await kb.search(session, business_id=_uuid.UUID(business_id), query=question, limit=4)

    if not hits:
        return KBAnswer(False, "", 0.0)

    best = hits[0].score
    if best < settings.kb_confidence_threshold:
        log.info("kb.below_threshold", score=best, threshold=settings.kb_confidence_threshold)
        return KBAnswer(False, "", best)

    # Only include chunks that are themselves reasonably relevant, so a single
    # strong hit isn't diluted by three weak ones.
    usable = [h for h in hits if h.score >= settings.kb_confidence_threshold * 0.8]
    context = "\n\n---\n\n".join(f"[{h.filename}]\n{h.chunk_text}" for h in usable)

    system = SYSTEM_TEMPLATE.format(
        business_name=business_name, abstain=ABSTAIN, context=context, style=_style(style)
    )
    result = await get_llm().complete(
        system, _messages(question, history), realtime=True, max_tokens=MAX_TOKENS
    )

    text = result.text.strip()
    if not text or ABSTAIN in text.upper() or result.refused:
        return KBAnswer(False, "", best, sources=[h.filename for h in usable], llm=result)

    return KBAnswer(
        answered=True,
        text=text,
        confidence=best,
        sources=sorted({h.filename for h in usable}),
        llm=result,
    )


# Enough for two spoken sentences; less output is also a faster reply.
MAX_TOKENS = 110
# Recent turns give the answer context ("in one session?" means the ants and
# the rodents the caller just described).
HISTORY_TURNS = 6


def _messages(question: str, history: list[dict[str, str]] | None) -> list[dict[str, str]]:
    recent = list(history or [])[-HISTORY_TURNS:]
    # The API needs the conversation to open with the caller.
    while recent and recent[0]["role"] != "user":
        recent.pop(0)
    return [*recent, {"role": "user", "content": question}]


# Up to roughly 3k tokens of reference text goes in whole.
WHOLE_KB_MAX_CHARS = 12_000


async def _small_kb(session: AsyncSession, business_id: object) -> list[tuple[str, str]] | None:
    from sqlalchemy import select

    from callsentry.models import KBDocument

    docs = (
        await session.execute(
            select(KBDocument.filename, KBDocument.content).where(
                KBDocument.business_id == business_id
            )
        )
    ).all()
    if not docs or sum(len(c or "") for _, c in docs) > WHOLE_KB_MAX_CHARS:
        return None
    return [(f, c) for f, c in docs]


def _style(playbook: str) -> str:
    if not playbook:
        return ""
    return (
        "\nHow this company's best reps talk (tone and technique only - every fact "
        "must still come from the reference material):\n" + playbook + "\n"
    )


async def _answer_from(
    docs: list[tuple[str, str]],
    *,
    business_name: str,
    question: str,
    history: list[dict[str, str]] | None = None,
    style: str = "",
) -> KBAnswer:
    context = "\n\n---\n\n".join(f"[{name}]\n{content}" for name, content in docs)
    system = SYSTEM_TEMPLATE.format(
        business_name=business_name, abstain=ABSTAIN, context=context, style=_style(style)
    )
    result = await get_llm().complete(
        system, _messages(question, history), realtime=True, max_tokens=MAX_TOKENS
    )
    text = result.text.strip()
    sources = sorted(name for name, _ in docs)
    if not text or ABSTAIN in text.upper() or result.refused:
        return KBAnswer(False, "", 0.0, sources=sources, llm=result)
    return KBAnswer(answered=True, text=text, confidence=1.0, sources=sources, llm=result)
