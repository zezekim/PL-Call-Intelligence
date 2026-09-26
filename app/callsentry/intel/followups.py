"""Follow-ups promised on calls, tracked until someone marks them done."""

from __future__ import annotations

from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.models import Call, CallAnalysis, FollowUp, ProcessingStatus

OPEN = "open"
DONE = "done"


async def sync(session: AsyncSession, call: Call, triage: dict[str, Any]) -> None:
    """Replace a call's open follow-ups with the latest analysis's list.

    Done ones stay done: re-scoring a call must not reopen work someone has
    already finished, so a new item matching a done one is skipped.
    """
    await session.execute(
        delete(FollowUp).where(FollowUp.call_id == call.id, FollowUp.status == OPEN)
    )
    done = {
        (a or "").strip().lower()
        for a in (
            await session.scalars(
                select(FollowUp.action).where(FollowUp.call_id == call.id,
                                              FollowUp.status == DONE)
            )
        ).all()
    }
    for item in triage.get("follow_ups") or []:
        action = str(item.get("action") or "").strip()
        # Things the customer said they would do are not the team's work.
        if not action or item.get("owner") == "customer" or action.lower() in done:
            continue
        session.add(
            FollowUp(
                business_id=call.business_id,
                call_id=call.id,
                action=action,
                owner=str(item.get("owner") or "")[:24] or None,
                due=str(item.get("due") or "")[:120] or None,
            )
        )
    await session.flush()


async def backfill(session: AsyncSession) -> int:
    """Create follow-ups for analysed calls that predate the table."""
    tracked = select(FollowUp.call_id).distinct()
    rows = (
        await session.execute(
            select(Call, CallAnalysis)
            .join(CallAnalysis, CallAnalysis.call_id == Call.id)
            .where(Call.processing_status == ProcessingStatus.DONE, Call.id.not_in(tracked))
        )
    ).all()
    count = 0
    for call, analysis in rows:
        if (analysis.triage or {}).get("follow_ups"):
            await sync(session, call, analysis.triage)
            count += 1
    await session.commit()
    return count
