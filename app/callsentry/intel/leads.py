"""Sales pipeline: each sales call creates or moves a lead."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.intel.rubrics import CallType
from callsentry.models import Call, CallAnalysis, Lead, LeadStage, ProcessingStatus

STAGES = [s.value for s in LeadStage]


def stage_for(triage: dict[str, Any]) -> str:
    sales = triage.get("sales") or {}
    outcome = sales.get("outcome")
    if outcome == "sold":
        return LeadStage.WON
    if outcome == "not_sold":
        return LeadStage.LOST
    if outcome == "follow_up":
        return LeadStage.QUOTED if (sales.get("price_quoted") or "").strip() else (
            LeadStage.FOLLOW_UP
        )
    return LeadStage.NEW


def name_key(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", name.lower()).strip()


async def sync(session: AsyncSession, call: Call, analysis: CallAnalysis) -> Lead | None:
    """Attach a sales call to its lead, creating or moving the lead as needed."""
    if analysis.call_type != CallType.SALES:
        call.lead_id = None
        return None

    triage = analysis.triage or {}
    display = (analysis.customer_name or "").strip()
    # Without a name there is nothing to match a later call against, so the
    # call gets a lead of its own rather than being merged with a stranger's.
    key = name_key(display) or f"call:{call.id}"
    display = display or f"Caller on {call.external_ref or 'unlabelled call'}"

    await session.execute(
        insert(Lead)
        .values(id=uuid.uuid4(), business_id=call.business_id, name=display, name_key=key,
                stage=LeadStage.NEW, pests=[])
        .on_conflict_do_nothing(index_elements=["business_id", "name_key"])
    )
    lead = await session.scalar(
        select(Lead).where(Lead.business_id == call.business_id, Lead.name_key == key)
    )
    if lead is None:
        return None

    sales = triage.get("sales") or {}
    follow_ups = triage.get("follow_ups") or []
    contact_at = call.occurred_at or call.created_at or datetime.now(UTC)
    is_latest = lead.last_contact_at is None or contact_at >= lead.last_contact_at
    if is_latest:
        lead.stage = stage_for(triage)
        lead.stage_source = "auto"
        lead.last_call_id = call.id
        lead.last_contact_at = contact_at
        lead.rep_id = call.rep_id
        lead.service = (sales.get("service_discussed") or "").strip() or lead.service
        lead.price_quoted = (sales.get("price_quoted") or "").strip() or lead.price_quoted
        lead.next_step = follow_ups[0].get("action") if follow_ups else None
    lead.pests = sorted({*(lead.pests or []), *(triage.get("pests") or [])})
    lead.updated_at = datetime.now(UTC)
    call.lead_id = lead.id
    return lead


async def backfill(session: AsyncSession) -> int:
    """Create leads for analysed sales calls that predate the pipeline."""
    rows = (
        await session.execute(
            select(Call, CallAnalysis)
            .join(CallAnalysis, CallAnalysis.call_id == Call.id)
            .where(Call.lead_id.is_(None), Call.call_type == CallType.SALES,
                   Call.processing_status == ProcessingStatus.DONE)
            .order_by(Call.created_at)
        )
    ).all()
    for call, analysis in rows:
        await sync(session, call, analysis)
    await session.commit()
    return len(rows)
