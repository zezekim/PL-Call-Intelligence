"""Sales pipeline: each sales call creates or moves a lead."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.intel import phones
from callsentry.intel.rubrics import CallType
from callsentry.models import Call, CallAnalysis, CallSource, Lead, LeadStage, ProcessingStatus

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
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", "", name.lower())).strip()


def same_person(key: str, phone: str | None, leads: list[tuple[Any, str, str | None]]) -> Any:
    """Which existing lead a call is about, or None for a new one.

    The same number is the same customer. Otherwise the same name, or a first
    name on its own ("maureen") against exactly one full name that starts with
    it ("maureen falzone"), either way round: callers often give only a first
    name on a second call. Two full names that start the same are left apart.
    """
    if phone:
        for lead_id, _, lead_phone in leads:
            if lead_phone == phone:
                return lead_id
    for lead_id, lead_key, _ in leads:
        if lead_key == key:
            return lead_id
    if not key or key.startswith("call:"):
        return None
    first = key.split(" ")[0]
    if " " in key:
        hits = [i for i, k, _ in leads if k == first]
    else:
        hits = [i for i, k, _ in leads if k.startswith(f"{key} ")]
    return hits[0] if len(hits) == 1 else None


def _receptionist_booking(call: Call, analysis: CallAnalysis) -> bool:
    """A caller who booked a visit with the AI receptionist.

    The receptionist has no customer list, so it cannot tell a new prospect
    from an existing customer; a booked visit is treated as a lead either way.
    """
    appointment = (analysis.triage or {}).get("appointment") or {}
    return call.source == CallSource.TWILIO and bool(appointment.get("booked"))


async def sync(session: AsyncSession, call: Call, analysis: CallAnalysis) -> Lead | None:
    """Attach a lead-generating call to its lead, creating or moving it as needed.

    Sales calls move the lead by their outcome. A visit booked with the AI
    receptionist creates a new lead, but never moves an existing lead back.
    """
    from_sales = analysis.call_type == CallType.SALES
    from_receptionist = not from_sales and _receptionist_booking(call, analysis)
    if not (from_sales or from_receptionist):
        call.lead_id = None
        return None

    triage = analysis.triage or {}
    display = (analysis.customer_name or "").strip()
    # Without a name there is nothing to match a later call against, so the
    # call gets a lead of its own rather than being merged with a stranger's.
    key = name_key(display) or f"call:{call.id}"
    display = display or f"Caller on {call.external_ref or 'unlabelled call'}"

    phone = phones.for_call(call, analysis)
    known = (
        await session.execute(
            select(Lead.id, Lead.name_key, Lead.phone).where(Lead.business_id == call.business_id)
        )
    ).all()
    match = same_person(key, phone, [(r[0], r[1], r[2]) for r in known])
    if match is None:
        await session.execute(
            insert(Lead)
            .values(id=uuid.uuid4(), business_id=call.business_id, name=display, name_key=key,
                    stage=LeadStage.NEW, pests=[])
            .on_conflict_do_nothing(index_elements=["business_id", "name_key"])
        )
        lead = await session.scalar(
            select(Lead).where(Lead.business_id == call.business_id, Lead.name_key == key)
        )
    else:
        lead = await session.get(Lead, match)
    if lead is None:
        return None
    # A fuller name than the one on file replaces it ("Maureen" → "Maureen Falzone").
    if (not key.startswith("call:") and len(key) > len(lead.name_key)
            and key.startswith(lead.name_key) and key not in {k for _, k, _ in known}):
        lead.name, lead.name_key = display, key

    sales = triage.get("sales") or {}
    follow_ups = triage.get("follow_ups") or []
    contact_at = call.occurred_at or call.created_at or datetime.now(UTC)
    is_latest = lead.last_contact_at is None or contact_at >= lead.last_contact_at
    if is_latest and from_sales:
        lead.stage = stage_for(triage)
        lead.stage_source = "auto"
        lead.last_call_id = call.id
        lead.last_contact_at = contact_at
        lead.rep_id = call.rep_id
        lead.service = (sales.get("service_discussed") or "").strip() or lead.service
        lead.price_quoted = (sales.get("price_quoted") or "").strip() or lead.price_quoted
        lead.next_step = follow_ups[0].get("action") if follow_ups else None
    elif is_latest:
        # Booked through the receptionist: record the visit, keep the stage.
        when = ((triage.get("appointment") or {}).get("when") or "").strip()
        request = ((triage.get("service") or {}).get("request") or "").strip()
        lead.last_call_id = call.id
        lead.last_contact_at = contact_at
        lead.rep_id = call.rep_id
        lead.service = request or lead.service
        lead.next_step = f"Visit booked for {when}" if when else "Visit booked"
    lead.phone = phone or lead.phone
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
            .where(Call.lead_id.is_(None),
                   or_(Call.call_type == CallType.SALES, Call.source == CallSource.TWILIO),
                   Call.processing_status == ProcessingStatus.DONE)
            .order_by(Call.created_at)
        )
    ).all()
    for call, analysis in rows:
        await sync(session, call, analysis)
    await session.commit()
    return len(rows)


async def merge_duplicates(session: AsyncSession) -> int:
    """Fold leads made before `same_person` into the lead they belong with.

    The fuller name is kept; whichever of the two was talked to last decides
    the stage, price and next step. Calls and prepared actions move across.
    """
    from callsentry.models import OwnerAction

    merged = 0
    businesses = (await session.scalars(select(Lead.business_id).distinct())).all()
    for business_id in businesses:
        leads = list((await session.scalars(
            select(Lead).where(Lead.business_id == business_id)
            .order_by(Lead.created_at))).all())
        for short in [lead for lead in leads if " " not in lead.name_key]:
            others = [(o.id, o.name_key, o.phone) for o in leads if o.id != short.id]
            match = same_person(short.name_key, short.phone, others)
            keep = next((o for o in leads if o.id == match), None)
            if keep is None:
                continue
            if (short.last_contact_at and keep.last_contact_at
                    and short.last_contact_at > keep.last_contact_at):
                for field in ("stage", "stage_source", "last_call_id", "last_contact_at",
                              "rep_id", "service", "price_quoted", "next_step"):
                    setattr(keep, field, getattr(short, field) or getattr(keep, field))
            keep.phone = keep.phone or short.phone
            keep.pests = sorted({*(keep.pests or []), *(short.pests or [])})
            keep.updated_at = datetime.now(UTC)
            await session.execute(
                update(Call).where(Call.lead_id == short.id).values(lead_id=keep.id))
            await session.execute(
                update(OwnerAction).where(OwnerAction.lead_id == short.id)
                .values(lead_id=keep.id))
            await session.delete(short)
            leads.remove(short)
            merged += 1
    await session.commit()
    return merged


async def refresh_contact(session: AsyncSession, lead_id: Any) -> None:
    """Recompute a lead's last contact from its calls after a date correction."""
    from sqlalchemy import func

    lead = await session.get(Lead, lead_id)
    if lead is None:
        return
    latest = await session.scalar(
        select(func.max(func.coalesce(Call.occurred_at, Call.created_at))).where(
            Call.lead_id == lead_id
        )
    )
    lead.last_contact_at = latest
