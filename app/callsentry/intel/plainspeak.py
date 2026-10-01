"""Rewrite a call's coaching in plain words.

Coaching written before plain language was asked for reads like a training
manual ("Signal the shift before presenting the solution"). This rewrites the
words only: the moments, quotes, timestamps and scorecard steps they point at
are kept exactly, so nothing about the grading changes.
"""

from __future__ import annotations

from typing import Any

from callsentry.services.llm import LLMResult, get_llm

PLAIN_RULES = """Write so anyone can understand it at a glance, including people who \
read slowly or speak English as a second language:
- Short, everyday words and short sentences. Aim for a 6th-grade reading level.
- No sales or training jargon (no "consensus", "objection", "expectation statement", \
"transition", "solution", "value", "WINs"). Say what to do in plain terms instead.
- Titles: at most 7 words, starting with a verb (e.g. "Say sorry about the problem first").
- "Try saying" lines sound like a friendly person on the phone, at most 2 short sentences."""

SYSTEM = f"""You edit coaching notes for a pest control call center so they are easy to read.
Keep the meaning, the facts, the names and the order exactly. Do not add advice, prices or \
policies that are not already there. Rewrite every field you are given.

{PLAIN_RULES}"""


def _schema(n_strengths: int, n_tips: int) -> dict[str, Any]:
    def obj(props: dict[str, Any]) -> dict[str, Any]:
        return {"type": "object", "properties": props, "required": list(props),
                "additionalProperties": False}

    text = {"type": "string"}
    return obj({
        "overall_feedback": text,
        "strengths": {"type": "array", "minItems": n_strengths, "maxItems": n_strengths,
                      "items": obj({"title": text, "detail": text})},
        "coaching": {"type": "array", "minItems": n_tips, "maxItems": n_tips,
                     "items": obj({"title": text, "what_happened": text, "try_saying": text,
                                   "why_it_matters": text})},
    })


def _brief(coaching: dict[str, Any]) -> str:
    lines = [f"overall_feedback: {coaching.get('overall_feedback', '')}", "", "strengths:"]
    for i, s in enumerate(coaching.get("strengths") or [], 1):
        lines += [f"{i}. title: {s.get('title', '')}", f"   detail: {s.get('detail', '')}"]
    lines += ["", "coaching:"]
    for i, c in enumerate(coaching.get("coaching") or [], 1):
        lines += [f"{i}. title: {c.get('title', '')}",
                  f"   what_happened: {c.get('what_happened', '')}",
                  f"   try_saying: {c.get('try_saying', '')}",
                  f"   why_it_matters: {c.get('why_it_matters', '')}"]
    return "\n".join(lines)


def merge(original: dict[str, Any], plain: dict[str, Any]) -> dict[str, Any]:
    """New wording on top of the original entries; everything else is kept."""
    strengths = [
        {**old, **{k: new[k] for k in ("title", "detail") if new.get(k)}}
        for old, new in zip(original.get("strengths") or [], plain.get("strengths") or [],
                            strict=False)
    ]
    tips = [
        {**old, **{k: new[k] for k in ("title", "what_happened", "try_saying", "why_it_matters")
                   if new.get(k)}}
        for old, new in zip(original.get("coaching") or [], plain.get("coaching") or [],
                            strict=False)
    ]
    return {
        **original,
        "overall_feedback": plain.get("overall_feedback") or original.get("overall_feedback", ""),
        "strengths": strengths or original.get("strengths") or [],
        "coaching": tips or original.get("coaching") or [],
        "plain": True,
    }


async def rewrite(coaching: dict[str, Any]) -> tuple[dict[str, Any], LLMResult]:
    strengths = len(coaching.get("strengths") or [])
    tips = len(coaching.get("coaching") or [])
    plain, result = await get_llm().analyse_json(
        SYSTEM, _brief(coaching), _schema(strengths, tips), effort="low", max_tokens=4000
    )
    return merge(coaching, plain), result
