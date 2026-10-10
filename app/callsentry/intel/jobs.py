"""In-process job runner for call processing.

The queue is the `calls` table itself: a call waits in `queued` (or
`queued_analysis` to re-score an existing transcript) and a worker claims it
with FOR UPDATE SKIP LOCKED, so several workers - or several API processes -
never pick up the same call. Nothing is held in memory, which means a restart
loses no work: calls caught mid-stage are put back in the queue at boot.
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import suppress

import structlog
from sqlalchemy import or_, select, update

from callsentry.config import get_settings
from callsentry.core.db import get_sessionmaker
from callsentry.intel import followups, ingest, leads, pipeline
from callsentry.models import Call, ProcessingStatus

log = structlog.get_logger(__name__)

IDLE_POLL_SECONDS = 2.0
_wake = asyncio.Event()


def notify() -> None:
    """Wake idle workers now instead of at their next poll."""
    _wake.set()


async def recover() -> int:
    """Requeue calls a previous process was working on when it stopped."""
    async with get_sessionmaker()() as session:
        # A call stopped mid-analysis keeps its transcript - no second
        # transcription bill for the same audio.
        analysing = await session.execute(
            update(Call)
            .where(Call.processing_status == ProcessingStatus.ANALYZING,
                   Call.segments != [])
            .values(processing_status=pipeline.QUEUED_ANALYSIS)
        )
        rest = await session.execute(
            update(Call)
            .where(Call.processing_status.in_(
                [ProcessingStatus.TRANSCRIBING, ProcessingStatus.ANALYZING]
            ))
            .values(processing_status=ProcessingStatus.QUEUED)
        )
        await session.commit()
        return int(getattr(analysing, "rowcount", 0) or 0) + int(getattr(rest, "rowcount", 0) or 0)


async def _claim() -> tuple[uuid.UUID, bool] | None:
    async with get_sessionmaker()() as session:
        row = (
            await session.execute(
                select(Call.id, Call.processing_status)
                .where(or_(Call.processing_status == ProcessingStatus.QUEUED,
                           Call.processing_status == pipeline.QUEUED_ANALYSIS))
                .order_by(Call.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).first()
        if row is None:
            return None
        call_id, status = row
        reuse = status == pipeline.QUEUED_ANALYSIS
        await session.execute(
            update(Call)
            .where(Call.id == call_id)
            .values(processing_status=(
                ProcessingStatus.ANALYZING if reuse else ProcessingStatus.TRANSCRIBING
            ))
        )
        await session.commit()
        return call_id, reuse


async def _worker(index: int) -> None:
    while True:
        try:
            claimed = await _claim()
        except Exception as exc:  # noqa: BLE001 - e.g. database not migrated yet
            log.warning("intel.claim_failed", worker=index, error=str(exc))
            claimed = None
        if claimed is None:
            _wake.clear()
            with suppress(TimeoutError):
                await asyncio.wait_for(_wake.wait(), timeout=IDLE_POLL_SECONDS)
            continue
        call_id, reuse = claimed
        log.info("intel.claimed", worker=index, call_id=str(call_id), reuse_transcript=reuse)
        async with get_sessionmaker()() as session:
            await pipeline.process(session, call_id, reuse_transcript=reuse)


async def run() -> None:
    try:
        recovered = await recover()
        if recovered:
            log.info("intel.recovered", count=recovered)
    except Exception as exc:  # noqa: BLE001
        log.warning("intel.recover_failed", error=str(exc))
    try:
        async with get_sessionmaker()() as session:
            tracked = await followups.backfill(session)
        if tracked:
            log.info("intel.followups_backfilled", calls=tracked)
    except Exception as exc:  # noqa: BLE001
        log.warning("intel.followups_backfill_failed", error=str(exc))
    try:
        async with get_sessionmaker()() as session:
            created = await leads.backfill(session)
            merged = await leads.merge_duplicates(session)
        if created:
            log.info("intel.leads_backfilled", calls=created)
        if merged:
            log.info("intel.leads_merged", leads=merged)
    except Exception as exc:  # noqa: BLE001
        log.warning("intel.leads_backfill_failed", error=str(exc))
    try:
        async with get_sessionmaker()() as session:
            hashed = await ingest.backfill_fingerprints(session)
        if hashed:
            log.info("intel.fingerprints_backfilled", calls=hashed)
    except Exception as exc:  # noqa: BLE001
        log.warning("intel.fingerprints_backfill_failed", error=str(exc))
    workers = max(1, get_settings().intel_workers)
    await asyncio.gather(*(_worker(i) for i in range(workers)))
