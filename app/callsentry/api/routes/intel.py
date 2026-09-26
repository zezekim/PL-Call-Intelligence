"""Call intelligence: upload recordings, review transcripts, scores and coaching."""

from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import selectinload

from callsentry.api.deps import BusinessDep, SessionDep
from callsentry.config import get_settings
from callsentry.intel import audio, ingest, jobs, pipeline
from callsentry.intel.rubrics import CALL_TYPE_LABELS, LENS_BY_CALL_TYPE, SCORECARDS
from callsentry.intel.transcribe import Engine
from callsentry.models import Call, CallAnalysis, CallSource, ProcessingStatus, Rep

router = APIRouter(prefix="/intel", tags=["call-intelligence"])

AUDIO_URL_TTL_SECONDS = 60 * 60


# --- Schemas -------------------------------------------------------------------


class CallRow(BaseModel):
    id: str
    external_ref: str | None
    original_filename: str | None
    occurred_at: datetime | None
    created_at: datetime
    duration_seconds: int
    processing_status: str
    processing_error: str | None
    call_type: str | None
    call_type_label: str | None
    lens: str | None
    rep_id: str | None
    rep_name: str | None
    customer_name: str | None
    summary: str | None
    outcome: str | None
    score: int | None
    score_max: int | None
    grade: str | None


class CallPage(BaseModel):
    items: list[CallRow]
    total: int


class AnalysisOut(BaseModel):
    model: str
    prompt_version: str
    updated_at: datetime
    call_type: str
    call_type_label: str
    call_type_confidence: float
    lens: str | None
    outcome: str | None
    rep_name: str | None
    customer_name: str | None
    summary: str | None
    scorecard_key: str | None
    scorecard_name: str | None
    score: int | None
    score_max: int | None
    grade: str | None
    evidence_verified_pct: float | None
    triage: dict[str, Any]
    items: list[dict[str, Any]]
    coaching: dict[str, Any]
    cost_usd: float


class CallDetailOut(CallRow):
    stt_engine: str | None
    stt_provider: str | None
    audio_channels: int | None
    audio_url: str | None
    segments: list[dict[str, Any]]
    analysis: AnalysisOut | None
    provider_log: list[dict[str, Any]]
    cost_usd: float


class ReprocessRequest(BaseModel):
    # keep: re-run analysis on the stored transcript. redo: transcribe again.
    transcript: str = "keep"
    engine: str | None = None


# --- Helpers -------------------------------------------------------------------


def _sign(call_id: str, expires: int) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, f"audio:{call_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def _audio_url(call: Call) -> str | None:
    if not call.audio_path:
        return None
    expires = int(time.time()) + AUDIO_URL_TTL_SECONDS
    return f"/intel/calls/{call.id}/audio?expires={expires}&sig={_sign(str(call.id), expires)}"


def _row(call: Call) -> CallRow:
    analysis = call.analysis
    return CallRow(
        id=str(call.id),
        external_ref=call.external_ref,
        original_filename=call.original_filename,
        occurred_at=call.occurred_at,
        created_at=call.created_at,
        duration_seconds=call.duration_seconds,
        processing_status=call.processing_status,
        processing_error=call.processing_error,
        call_type=call.call_type,
        call_type_label=CALL_TYPE_LABELS.get(call.call_type) if call.call_type else None,
        lens=LENS_BY_CALL_TYPE.get(call.call_type) if call.call_type else None,
        rep_id=str(call.rep_id) if call.rep_id else None,
        rep_name=call.rep.name if call.rep else (analysis.rep_name if analysis else None),
        customer_name=analysis.customer_name if analysis else None,
        summary=call.summary,
        outcome=analysis.outcome if analysis else None,
        score=call.score,
        score_max=call.score_max,
        grade=call.grade,
    )


def _analysis_out(a: CallAnalysis) -> AnalysisOut:
    scorecard = SCORECARDS.get(a.scorecard_key or "")
    return AnalysisOut(
        model=a.model,
        prompt_version=a.prompt_version,
        updated_at=a.updated_at,
        call_type=a.call_type,
        call_type_label=CALL_TYPE_LABELS.get(a.call_type, a.call_type),
        call_type_confidence=float(a.call_type_confidence or 0),
        lens=a.lens,
        outcome=a.outcome,
        rep_name=a.rep_name,
        customer_name=a.customer_name,
        summary=a.summary,
        scorecard_key=a.scorecard_key,
        scorecard_name=scorecard.name if scorecard else None,
        score=a.score,
        score_max=a.score_max,
        grade=a.grade,
        evidence_verified_pct=(
            float(a.evidence_verified_pct) if a.evidence_verified_pct is not None else None
        ),
        triage=a.triage or {},
        items=a.items or [],
        coaching=a.coaching or {},
        cost_usd=float(a.cost_usd or 0),
    )


async def _owned_call(session: SessionDep, business_id: uuid.UUID, call_id: uuid.UUID) -> Call:
    call = await session.scalar(
        select(Call)
        .where(Call.id == call_id)
        .options(selectinload(Call.analysis), selectinload(Call.rep))
    )
    # Same 404 for missing and foreign rows, so other tenants' ids don't leak.
    if call is None or call.business_id != business_id or call.source != CallSource.UPLOAD:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "call not found")
    return call


def _base_query(business_id: uuid.UUID) -> Select[Any]:
    return select(Call).where(Call.business_id == business_id, Call.source == CallSource.UPLOAD)


# --- Routes --------------------------------------------------------------------


@router.post("/uploads", response_model=list[CallRow], status_code=status.HTTP_201_CREATED)
async def upload(
    session: SessionDep,
    business: BusinessDep,
    files: Annotated[list[UploadFile], File(description="One or more call recordings")],
    engine: Annotated[str, Form()] = "",
) -> list[CallRow]:
    engine = engine or get_settings().call_stt_engine
    if engine not in {e.value for e in Engine}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "engine must be auto, deepgram or local")

    created: list[Call] = []
    for upload_file in files:
        try:
            call = await ingest.ingest(
                session,
                business_id=business.id,
                filename=upload_file.filename or "recording",
                data=await upload_file.read(),
                engine=engine,
            )
        except ingest.RejectedUpload as exc:
            # The whole batch is rolled back; don't leave its files behind.
            for earlier in created:
                path = pipeline.audio_file(earlier)
                if path is not None:
                    path.unlink(missing_ok=True)
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        created.append(call)

    for call in created:
        await session.refresh(call, ["created_at", "analysis", "rep"])
    await session.commit()
    jobs.notify()
    return [_row(c) for c in created]


@router.get("/calls", response_model=CallPage)
async def list_calls(
    session: SessionDep,
    business: BusinessDep,
    call_type: str | None = None,
    lens: str | None = None,
    rep_id: uuid.UUID | None = None,
    grade: str | None = None,
    status_: Annotated[str | None, Query(alias="status")] = None,
    q: str | None = None,
    limit: Annotated[int, Query(le=200)] = 50,
    offset: int = 0,
) -> CallPage:
    stmt = _base_query(business.id)
    if call_type:
        stmt = stmt.where(Call.call_type == call_type)
    if lens:
        types = [t for t, lens_ in LENS_BY_CALL_TYPE.items() if lens_ == lens]
        stmt = stmt.where(Call.call_type.in_(types))
    if rep_id:
        stmt = stmt.where(Call.rep_id == rep_id)
    if grade:
        stmt = stmt.where(Call.grade == grade)
    if status_:
        stmt = stmt.where(Call.processing_status == status_)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.outerjoin(CallAnalysis, CallAnalysis.call_id == Call.id).where(
            or_(
                Call.transcript.ilike(pattern),
                Call.summary.ilike(pattern),
                Call.external_ref.ilike(pattern),
                Call.original_filename.ilike(pattern),
                CallAnalysis.customer_name.ilike(pattern),
                CallAnalysis.rep_name.ilike(pattern),
            )
        )

    total = await session.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (
        await session.scalars(
            stmt.options(selectinload(Call.analysis), selectinload(Call.rep))
            .order_by(func.coalesce(Call.occurred_at, Call.created_at).desc(),
                      Call.external_ref.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return CallPage(items=[_row(c) for c in rows], total=int(total or 0))


@router.get("/calls/{call_id}", response_model=CallDetailOut)
async def get_call(call_id: uuid.UUID, session: SessionDep, business: BusinessDep) -> CallDetailOut:
    call = await _owned_call(session, business.id, call_id)
    return CallDetailOut(
        **_row(call).model_dump(),
        stt_engine=call.stt_engine,
        stt_provider=call.stt_provider,
        audio_channels=call.audio_channels,
        audio_url=_audio_url(call),
        segments=call.segments or [],
        analysis=_analysis_out(call.analysis) if call.analysis else None,
        provider_log=call.provider_log or [],
        cost_usd=round(float(call.cost_usd or 0), 6),
    )


@router.post("/calls/{call_id}/reprocess", response_model=CallRow)
async def reprocess(
    call_id: uuid.UUID,
    payload: ReprocessRequest,
    session: SessionDep,
    business: BusinessDep,
) -> CallRow:
    call = await _owned_call(session, business.id, call_id)
    if call.processing_status in (
        ProcessingStatus.QUEUED, ProcessingStatus.TRANSCRIBING, ProcessingStatus.ANALYZING,
        pipeline.QUEUED_ANALYSIS,
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "call is already being processed")
    if payload.engine is not None:
        if payload.engine not in {e.value for e in Engine}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown engine")
        call.stt_engine = payload.engine
    keep = payload.transcript == "keep" and bool(call.segments) and payload.engine is None
    call.processing_status = pipeline.QUEUED_ANALYSIS if keep else ProcessingStatus.QUEUED
    call.processing_error = None
    await session.commit()
    jobs.notify()
    return _row(call)


@router.delete("/calls/{call_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_call(call_id: uuid.UUID, session: SessionDep, business: BusinessDep) -> None:
    """Delete a call, its analysis and its recording file."""
    call = await _owned_call(session, business.id, call_id)
    path = pipeline.audio_file(call)
    await session.delete(call)
    await session.commit()
    if path is not None:
        path.unlink(missing_ok=True)


@router.get("/calls/{call_id}/audio", include_in_schema=False)
async def call_audio(
    call_id: uuid.UUID, session: SessionDep, expires: int, sig: str
) -> FileResponse:
    """Stream a recording. Authorised by a short-lived signature rather than a
    bearer header, because an <audio> element cannot send one."""
    if expires < time.time() or not hmac.compare_digest(sig, _sign(str(call_id), expires)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "link expired")
    call = await session.get(Call, call_id)
    path = pipeline.audio_file(call) if call else None
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "recording not found")
    return FileResponse(path, media_type=audio.content_type(path))


@router.get("/reps", response_model=list[dict[str, Any]])
async def list_reps(session: SessionDep, business: BusinessDep) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(Rep, func.count(Call.id))
            .outerjoin(Call, Call.rep_id == Rep.id)
            .where(Rep.business_id == business.id)
            .group_by(Rep.id)
            .order_by(Rep.name)
        )
    ).all()
    return [{"id": str(r.id), "name": r.name, "calls": int(n)} for r, n in rows]
