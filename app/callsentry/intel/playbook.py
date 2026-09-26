"""Receptionist playbook: how the best reps handle calls, learned from calls.

The receptionist is reachable by anyone with the phone number, so what it
learns from recorded calls is technique, never facts about people:

  - the model is told to generalise (no names, companies, prices, dates,
    addresses or account details), and
  - every entry is then checked against the names, companies and contact
    patterns seen in the analysed calls; anything that matches is dropped.

The result is a draft. A manager reads and edits it, and only the published
version reaches live calls. Prices and policies still come only from the
business FAQ.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from callsentry.intel.rubrics import CALL_TYPE_LABELS
from callsentry.intel.transcript import Segment, render
from callsentry.models import Call, CallAnalysis, ProcessingStatus, ReceptionistPlaybook
from callsentry.services.llm import LLMResult, get_llm

DRAFT = "draft"
PUBLISHED = "published"

# Keeps one generation request well inside a single context window.
MAX_TRANSCRIPT_CHARS = 90_000

STEPS = ["validate", "confidence", "expectation", "investigate", "summary", "close", "thank",
         "final_information"]
STEP_TITLES = {
    "validate": "Validate the caller's situation",
    "confidence": "Build confidence",
    "expectation": "Set expectations",
    "investigate": "Ask good questions",
    "summary": "Summarise what matters to them",
    "close": "Move to the next step",
    "thank": "Thank the caller",
    "final_information": "Final information",
}


def _obj(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties),
            "additionalProperties": False}


SCHEMA = _obj(
    {
        "caller_questions": {
            "type": "array",
            "items": _obj({"question": {"type": "string"}, "how_to_answer": {"type": "string"}}),
        },
        "phrases": {
            "type": "array",
            "items": _obj({"step": {"type": "string", "enum": STEPS},
                           "example": {"type": "string"}}),
        },
        "objections": {
            "type": "array",
            "items": _obj({"objection": {"type": "string"}, "response": {"type": "string"}}),
        },
        "booking_details": {"type": "array", "items": {"type": "string"}},
        "avoid": {"type": "array", "items": {"type": "string"}},
    }
)

SYSTEM = """You train a pest control company's phone receptionist. You are given
recorded calls between the company's reps and customers, each with its call
type and scorecard grade. Higher-graded calls show the company's standard.

Write a playbook of reusable technique:
- caller_questions: the questions callers actually ask, and how the best reps
  handled each one (the approach, not the specific answer).
- phrases: short example lines, in the best reps' style, for each step of the
  call process. Write them so they work for any caller - use placeholders such
  as [pest], [room], [day] instead of specifics.
- objections: concerns callers raised and how to respond well.
- booking_details: what the best reps collect before booking a visit.
- avoid: habits from lower-graded calls that the receptionist must not copy.

Hard rules - the playbook will be used on a public phone line:
- No personal information: no names of customers or reps, no phone numbers,
  emails, street addresses, account or card details.
- No company names, no prices, fees, discounts, dates or times. Pricing and
  policy come from elsewhere.
- Generalise. If an example only makes sense for one customer, leave it out.
Aim for 6-12 caller questions, 2-3 phrases per step, and every distinct
objection you saw."""


@dataclass
class Draft:
    content: str
    source_calls: int
    removed_items: int
    llm: LLMResult


_PATTERNS = [
    re.compile(r"\$\s?\d"),                                   # prices
    re.compile(r"\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b"),         # phone numbers
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),                   # emails
    re.compile(r"\b\d{1,6}(\s+[\w.'-]+){1,4}\s+(street|st|avenue|ave|road|rd|lane|ln|drive|dr|"
               r"boulevard|blvd|way|court|ct|circle|place|pl|parkway|pkwy)\b", re.I),  # addresses
    re.compile(r"\b\d{1,2}(:\d{2})?\s?(am|pm)\b", re.I),     # times
]


def blocklist(analyses: list[CallAnalysis]) -> set[str]:
    """Names and company names seen in the calls, as lower-case words."""
    words: set[str] = set()
    for a in analyses:
        values = [a.customer_name, a.rep_name, (a.triage or {}).get("company_name")]
        for value in values:
            for word in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", value or ""):
                words.add(word.lower())
    # Generic words that also appear in company names would wipe the playbook.
    return words - {"pest", "control", "services", "service", "the", "and", "company",
                    "exterminating", "termite", "bug", "bugs", "lawn", "home"}


def is_clean(text: str, blocked: set[str]) -> bool:
    if any(p.search(text) for p in _PATTERNS):
        return False
    tokens = {t.lower() for t in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", text)}
    return not (tokens & blocked)


def render_markdown(data: dict[str, Any], blocked: set[str]) -> tuple[str, int]:
    removed = 0
    lines: list[str] = ["# Receptionist playbook", ""]

    def keep(*texts: str) -> bool:
        nonlocal removed
        if all(is_clean(t or "", blocked) for t in texts):
            return True
        removed += 1
        return False

    questions = [q for q in data.get("caller_questions") or []
                 if keep(q.get("question", ""), q.get("how_to_answer", ""))]
    if questions:
        lines += ["## Questions callers ask", ""]
        lines += [f"- **{q['question']}** {q['how_to_answer']}" for q in questions]
        lines.append("")

    by_step: dict[str, list[str]] = {}
    for p in data.get("phrases") or []:
        if keep(p.get("example", "")):
            by_step.setdefault(p.get("step", ""), []).append(p["example"])
    if by_step:
        lines += ["## How the best reps say it", ""]
        for step in STEPS:
            if by_step.get(step):
                lines.append(f"**{STEP_TITLES[step]}**")
                lines += [f'- "{e}"' for e in by_step[step]]
                lines.append("")

    objections = [o for o in data.get("objections") or []
                  if keep(o.get("objection", ""), o.get("response", ""))]
    if objections:
        lines += ["## Objections", ""]
        lines += [f"- **{o['objection']}** {o['response']}" for o in objections]
        lines.append("")

    booking = [b for b in data.get("booking_details") or [] if keep(b)]
    if booking:
        lines += ["## Before booking, collect", ""] + [f"- {b}" for b in booking] + [""]

    avoid = [a for a in data.get("avoid") or [] if keep(a)]
    if avoid:
        lines += ["## Avoid", ""] + [f"- {a}" for a in avoid] + [""]

    return "\n".join(lines).strip() + "\n", removed


async def generate(session: AsyncSession, business_id: Any) -> Draft:
    rows = (
        await session.execute(
            select(Call, CallAnalysis)
            .join(CallAnalysis, CallAnalysis.call_id == Call.id)
            .where(Call.business_id == business_id,
                   Call.processing_status == ProcessingStatus.DONE,
                   CallAnalysis.score_max.isnot(None))
            .options(selectinload(Call.analysis))
        )
    ).all()
    if not rows:
        raise ValueError("there are no graded calls to learn from yet")

    # Best-graded calls first, so a length limit drops the weakest examples.
    rows = sorted(rows, key=lambda r: (r[1].score or 0) / (r[1].score_max or 1), reverse=True)
    parts: list[str] = []
    used = 0
    size = 0
    for call, analysis in rows:
        segments = [Segment.from_dict(s) for s in call.segments or []]
        text = render(segments, by_role=True)
        block = (
            f"## Call {used + 1}: {CALL_TYPE_LABELS.get(analysis.call_type, analysis.call_type)}, "
            f"graded {analysis.score}/{analysis.score_max}\n{text}"
        )
        if size + len(block) > MAX_TRANSCRIPT_CHARS:
            continue
        parts.append(block)
        size += len(block)
        used += 1

    data, llm = await get_llm().analyse_json(SYSTEM, "\n\n".join(parts), SCHEMA, effort="medium")
    if not data:
        raise ValueError("the model returned no playbook")
    content, removed = render_markdown(data, blocklist([a for _, a in rows]))
    return Draft(content=content, source_calls=used, removed_items=removed, llm=llm)


async def get(session: AsyncSession, business_id: Any, status: str) -> ReceptionistPlaybook | None:
    return await session.scalar(
        select(ReceptionistPlaybook).where(
            ReceptionistPlaybook.business_id == business_id,
            ReceptionistPlaybook.status == status,
        )
    )


async def save(
    session: AsyncSession, business_id: Any, status: str, content: str,
    *, source_calls: int | None = None, removed_items: int | None = None,
) -> ReceptionistPlaybook:
    row = await get(session, business_id, status)
    if row is None:
        row = ReceptionistPlaybook(business_id=business_id, status=status, content=content)
        session.add(row)
    row.content = content
    row.updated_at = datetime.now(UTC)
    if source_calls is not None:
        row.source_calls = source_calls
    if removed_items is not None:
        row.removed_items = removed_items
    await session.flush()
    return row


async def published_text(session: AsyncSession, business_id: Any) -> str:
    row = await get(session, business_id, PUBLISHED)
    return row.content if row else ""
