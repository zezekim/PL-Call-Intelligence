"""Insert one fully analysed, entirely fictional sales call for browser tests.

No recording and no model calls: the transcript, score and coaching are made
up here, so the end-to-end suite can exercise the call page (scorecard,
overrides, follow-ups) in CI without audio or API keys. Idempotent.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from callsentry.core.db import get_sessionmaker
from callsentry.intel import overrides
from callsentry.intel.pipeline import get_or_create_rep
from callsentry.intel.rubrics import SCORECARDS
from callsentry.models import (
    Business,
    Call,
    CallAnalysis,
    CallSource,
    FollowUp,
    ProcessingStatus,
)

REF = "E2E-001"

LINES = [
    ("rep", "Thanks for calling ABC Pest Control, this is Jordan. How can I help?"),
    ("customer", "Hi, I'm Casey Example. We keep finding ants in the kitchen."),
    ("rep", "Oh no, ants in the kitchen are the worst. We can definitely take care of that."),
    ("customer", "How much would a treatment cost?"),
    ("rep", "Our quarterly plan is $49 a month with a free first inspection."),
    ("customer", "That works. Can someone come Thursday?"),
    ("rep", "Thursday between 9 and 11 works. I'll send a confirmation text."),
]

# Steps missed on purpose; one of them is left disputed for a manager to settle.
MISSED = {"summary_statement", "consensus"}
DISPUTED = "summary_statement"


def _segments() -> list[dict]:
    return [
        {"id": i, "start": i * 6.0, "end": i * 6.0 + 5.5, "text": text,
         "speaker": 0 if role == "rep" else 1, "role": role}
        for i, (role, text) in enumerate(LINES)
    ]


def _items() -> list[dict]:
    items = []
    for item in SCORECARDS["sales"].items:
        met = item.key not in MISSED
        items.append({
            "key": item.key, "label": item.label, "quadrant": item.quadrant,
            "status": "met" if met else "missed", "awarded": met,
            "reason": "Synthetic verdict for browser tests.",
            "evidence": [{"role": "rep", "quote": LINES[2][1], "start": 12.0,
                          "segment_id": 2, "verified": True}],
            "agreement": "disputed" if item.key == DISPUTED else "both",
            "auto_awarded": False,
        })
    return items


async def main() -> None:
    async with get_sessionmaker()() as session:
        business = await session.scalar(select(Business).limit(1))
        if business is None:
            raise SystemExit("run the seed script first")
        if await session.scalar(select(Call).where(Call.external_ref == REF)):
            print("E2E fixture already present")
            return

        rep = await get_or_create_rep(session, business.id, "Jordan")
        items, score, grade = overrides.apply(_items(), {}, "sales")
        when = datetime.now(UTC) - timedelta(hours=3)
        call = Call(
            business_id=business.id, caller_number="", source=CallSource.UPLOAD,
            external_ref=REF, original_filename=f"{REF}.mp3", duration_seconds=42,
            processing_status=ProcessingStatus.DONE, occurred_at=when,
            segments=_segments(), transcript="\n".join(t for _, t in LINES),
            summary="Casey called about ants in the kitchen and booked a Thursday inspection.",
            call_type="sales", rep_id=rep.id if rep else None, score=score,
            score_max=len(items), grade=grade, stt_provider="fixture", provider_log=[],
        )
        session.add(call)
        await session.flush()
        session.add(CallAnalysis(
            call_id=call.id, business_id=business.id, model="fixture",
            scoring_mode="enhanced", prompt_version="fixture", call_type="sales",
            call_type_confidence=0.95, lens="sales", outcome="sold", rep_name="Jordan",
            customer_name="Casey Example", summary=call.summary, scorecard_key="sales",
            score=score, score_max=len(items), grade=grade, evidence_verified_pct=100,
            items=items,
            triage={
                "direction": "inbound", "pests": ["ants"], "customer_wins": ["quick visit"],
                "call_type_reason": "Prospect asked for a price and booked.",
                "appointment": {"booked": True, "when": "Thursday 9-11am"},
                "sales": {"outcome": "sold", "objections": [], "lost_reason": "",
                          "price_quoted": "$49 a month", "service_discussed": "Quarterly plan"},
                "retention": {"outcome": "", "root_cause": "", "offers_made": [],
                              "cancel_reason": "", "under_contract": "",
                              "first_offer_accepted": False},
                "service": {"request": "", "resolution": "", "actions_taken": []},
            },
            coaching={
                "overall_feedback": "Friendly and quick to book.",
                "strengths": [],
                "coaching": [{
                    "title": "Summarise before quoting", "item_keys": [DISPUTED],
                    "what_happened": "The price came before a recap of the problem.",
                    "why_it_matters": "A recap shows the customer they were heard.",
                    "try_saying": "So it's ants in the kitchen and you'd like them gone fast.",
                    "start": 18.0, "segment_id": 3,
                }],
            },
        ))
        session.add(FollowUp(
            business_id=business.id, call_id=call.id,
            action="Text Casey the Thursday confirmation", owner="rep", due="today",
        ))
        await session.commit()
        print(f"E2E fixture created: {call.id}")


if __name__ == "__main__":
    asyncio.run(main())
