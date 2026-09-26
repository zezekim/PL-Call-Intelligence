"""Recording -> transcript -> analysis -> stored result, for one call."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.config import get_settings
from callsentry.core.providers import ProviderUnavailable
from callsentry.intel import analyze, audio, leads
from callsentry.intel.analyze import Analysis, AnalysisFailed
from callsentry.intel.transcribe import EmptyTranscript, transcribe
from callsentry.intel.transcript import Segment, exact_speakers, merge_adjacent, plain_text
from callsentry.models import (
    Call,
    CallAnalysis,
    CallOutcome,
    CallSource,
    CostCategory,
    ProcessingStatus,
    Rep,
)
from callsentry.services import costs

log = structlog.get_logger(__name__)

AI_REP_NAME = "AI Receptionist"

# Status for a call whose transcript is kept and only the analysis re-runs.
QUEUED_ANALYSIS = "queued_analysis"


def upload_root() -> Path:
    return Path(get_settings().upload_dir).resolve()


def audio_file(call: Call) -> Path | None:
    if not call.audio_path:
        return None
    root = upload_root()
    path = (root / call.audio_path).resolve()
    # Stored paths are ours, but never follow one out of the upload root.
    return path if root in path.parents and path.is_file() else None


def rep_key(name: str) -> str:
    first = re.split(r"\s+", name.strip())[0] if name.strip() else ""
    return re.sub(r"[^a-z'-]", "", first.lower())


async def get_or_create_rep(
    session: AsyncSession, business_id: uuid.UUID, name: str
) -> Rep | None:
    if name == AI_REP_NAME:
        key, display = "ai-receptionist", AI_REP_NAME
    else:
        key = rep_key(name)
        if not key:
            return None
        display = name.strip().split()[0].capitalize()
    # ON CONFLICT so two workers finishing calls for the same new rep at once
    # don't collide on the unique index.
    await session.execute(
        insert(Rep)
        .values(id=uuid.uuid4(), business_id=business_id, name=display, name_key=key)
        .on_conflict_do_nothing(index_elements=["business_id", "name_key"])
    )
    return await session.scalar(
        select(Rep).where(Rep.business_id == business_id, Rep.name_key == key)
    )


def _friendly_error(exc: Exception) -> str:
    if isinstance(exc, ProviderUnavailable):
        text = str(exc)
        if "daily spending cap" in text:
            return (
                "Today's spending cap has been reached. "
                "Retry tomorrow or raise the cap in Settings."
            )
        if "Claude API key not set" in text or "claude: disabled" in text:
            return "Claude is not configured, so the call could not be scored."
        if "stt" in text:
            return "No transcription engine was available. " + text.split(":", 1)[-1].strip()
        return text
    if isinstance(exc, audio.AudioError):
        return f"The recording could not be read: {exc}"
    if isinstance(exc, EmptyTranscript):
        return "No speech was found in the recording."
    if isinstance(exc, AnalysisFailed):
        return f"Analysis did not complete: {exc}"
    return f"{type(exc).__name__}: {exc}"[:500]


async def process(session: AsyncSession, call_id: uuid.UUID, *, reuse_transcript: bool) -> None:
    """Run (or re-run) the pipeline for one call. Commits as it goes so the
    UI can show which stage a call is in."""
    call = await session.get(Call, call_id)
    if call is None:
        return
    try:
        if reuse_transcript and call.segments:
            segments = [Segment.from_dict(s) for s in call.segments]
        else:
            segments = await _transcribe(session, call)
        diarized = exact_speakers(segments)

        call.processing_status = ProcessingStatus.ANALYZING
        await session.commit()

        result = await analyze.analyse(
            segments, diarized=diarized, forced_type=call.call_type_override
        )
        await _store(session, call, segments, result)
        call.processing_status = ProcessingStatus.DONE
        call.processing_error = None
        await session.commit()
        log.info("intel.processed", call_id=str(call.id), call_type=result.call_type,
                 grade=result.grade, score=result.score)
    except Exception as exc:  # noqa: BLE001 - any failure is recorded on the call
        await session.rollback()
        call = await session.get(Call, call_id)
        if call is None:
            return
        call.processing_status = ProcessingStatus.FAILED
        call.processing_error = _friendly_error(exc)
        await session.commit()
        log.warning("intel.failed", call_id=str(call_id), error=str(exc))


async def _transcribe(session: AsyncSession, call: Call) -> list[Segment]:
    path = audio_file(call)
    if path is None:
        raise audio.AudioError("recording file is missing")
    call.processing_status = ProcessingStatus.TRANSCRIBING
    await session.commit()

    result = await transcribe(path, engine=call.stt_engine or get_settings().call_stt_engine)
    segments = merge_adjacent(result.segments) if result.diarized else result.segments

    call.segments = [s.to_dict() for s in segments]
    call.stt_provider = result.provider
    call.duration_seconds = int(round(result.duration_seconds))
    call.provider_log = [*(call.provider_log or []), *(a.__dict__ for a in result.attempts)]
    await costs.record(
        session,
        business_id=call.business_id,
        call_id=call.id,
        category=CostCategory.STT,
        provider=result.provider,
        tier=result.tier,
        units=result.duration_seconds / 60,
        unit_name="audio_minute",
        cost_usd=result.cost_usd,
    )
    await session.commit()
    return segments


async def _store(
    session: AsyncSession, call: Call, segments: list[Segment], result: Analysis
) -> None:
    if call.source == CallSource.TWILIO:
        # Answered by the AI receptionist, which introduces itself without a name.
        result.rep_name = AI_REP_NAME
    rep = await get_or_create_rep(session, call.business_id, result.rep_name or "")

    call.segments = [s.to_dict() for s in segments]
    call.transcript = plain_text(segments)
    call.summary = result.summary
    call.call_type = result.call_type
    call.rep_id = rep.id if rep else None
    call.score = result.score
    call.score_max = result.score_max
    call.grade = result.grade
    call.sentiment = result.triage.get("customer_sentiment_end")
    appointment = result.triage.get("appointment") or {}
    reason = result.triage.get("not_scorable_reason")
    call.outcome = (
        CallOutcome.VOICEMAIL if reason == "voicemail"
        else CallOutcome.BOOKED if appointment.get("booked")
        else CallOutcome.ANSWERED
    )

    row = await session.scalar(select(CallAnalysis).where(CallAnalysis.call_id == call.id))
    if row is None:
        row = CallAnalysis(call_id=call.id, business_id=call.business_id)
        session.add(row)
    row.updated_at = datetime.now(UTC)
    row.model = get_settings().call_intel_model
    row.prompt_version = analyze.PROMPT_VERSION
    row.call_type = result.call_type
    row.call_type_confidence = result.call_type_confidence
    row.lens = result.lens
    row.outcome = result.outcome
    row.rep_name = result.rep_name
    row.customer_name = result.customer_name
    row.summary = result.summary
    row.scorecard_key = result.scorecard_key
    row.score = result.score
    row.score_max = result.score_max
    row.grade = result.grade
    row.evidence_verified_pct = result.evidence_verified_pct
    row.triage = result.triage
    row.items = result.items
    row.coaching = result.coaching
    row.cost_usd = result.cost_usd
    await session.flush()
    await leads.sync(session, call, row)

    for llm in result.llm_results:
        await costs.record(
            session,
            business_id=call.business_id,
            call_id=call.id,
            category=CostCategory.LLM,
            provider=llm.provider,
            tier=llm.tier,
            units=llm.total_tokens / 1000,
            unit_name="1k_tokens",
            cost_usd=llm.cost_usd,
        )
        call.provider_log = [*(call.provider_log or []), *(a.__dict__ for a in llm.attempts)]
    await costs.recompute_call_cost(session, call.id)
