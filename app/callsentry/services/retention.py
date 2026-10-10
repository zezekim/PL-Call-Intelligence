"""Data-retention sweep and GDPR erasure.

Recordings are deleted on their own `recording_expires_at` stamp, which is
written once at ingest. That means changing the retention policy affects new
calls only - it never retroactively destroys media a business still expects
to have.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import structlog
from sqlalchemy import delete, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.config import get_settings
from callsentry.models import Appointment, Call, CostEntry

log = structlog.get_logger(__name__)


async def sweep(session: AsyncSession) -> dict[str, int]:
    """Expire recordings and old transcripts. Safe to run repeatedly."""
    settings = get_settings()
    now = datetime.now(UTC)

    recordings = await session.execute(
        update(Call)
        .where(Call.recording_url.isnot(None), Call.recording_expires_at <= now)
        .values(recording_url=None)
    )

    # Uploaded and receptionist recordings live on disk: delete the file, keep
    # the transcript and score until the transcript's own expiry.
    from callsentry.intel.pipeline import audio_file

    expired = (
        await session.scalars(
            select(Call).where(Call.audio_path.isnot(None), Call.recording_expires_at <= now)
        )
    ).all()
    for call in expired:
        path = audio_file(call)
        if path is not None:
            path.unlink(missing_ok=True)
        call.audio_path = None

    transcript_cutoff = now - timedelta(days=settings.transcript_retention_days)
    transcripts = await session.execute(
        update(Call)
        .where(Call.transcript.isnot(None), Call.created_at <= transcript_cutoff)
        .values(transcript=None)
    )

    result = {
        # UPDATE and DELETE return a cursor result, which carries the row count.
        "recordings_purged": (cast(CursorResult[Any], recordings).rowcount or 0) + len(expired),
        "transcripts_purged": cast(CursorResult[Any], transcripts).rowcount or 0,
    }
    log.info("retention.sweep", **result)
    return result


async def erase_caller(
    session: AsyncSession, *, business_id: uuid.UUID, phone: str
) -> dict[str, int]:
    """GDPR Article 17: erase everything tied to one phone number.

    Call rows are kept but stripped of identifying content, because the cost
    ledger and volume analytics reference them. What remains cannot identify
    the individual.
    """
    calls = (
        await session.scalars(
            select(Call).where(Call.business_id == business_id, Call.caller_number == phone)
        )
    ).all()

    for call in calls:
        call.caller_number = "[erased]"
        call.transcript = None
        call.summary = None
        call.recording_url = None
        call.escalation_reason = None

    appointments = await session.execute(
        delete(Appointment).where(
            Appointment.business_id == business_id, Appointment.caller_phone == phone
        )
    )

    result = {
        "calls_anonymised": len(calls),
        "appointments_deleted": cast(CursorResult[Any], appointments).rowcount or 0,
    }
    log.info("retention.erasure", business_id=str(business_id), **result)
    return result


async def purge_business(session: AsyncSession, business_id: uuid.UUID) -> None:
    """Remove all cost history for a tenant, used before a hard delete."""
    await session.execute(delete(CostEntry).where(CostEntry.business_id == business_id))
