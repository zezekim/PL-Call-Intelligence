"""Call intelligence: upload recordings, review transcripts, scores and coaching."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import Select, cast, func, or_, select, update
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.orm import selectinload

from callsentry.api.deps import BusinessDep, SessionDep, UserDep
from callsentry.config import get_settings
from callsentry.intel import (
    audio,
    brief,
    followups,
    ingest,
    insights,
    jobs,
    overrides,
    pipeline,
    transcript_edit,
)
from callsentry.intel import leads as leads_service
from callsentry.intel import rules as scoring_rules
from callsentry.intel.rubrics import CALL_TYPE_LABELS, LENS_BY_CALL_TYPE, SCORECARDS, CallType
from callsentry.intel.transcribe import Engine
from callsentry.intel.transcript import Segment, plain_text
from callsentry.models import (
    Call,
    CallAnalysis,
    FollowUp,
    Lead,
    ProcessingStatus,
    Rep,
    ScoringRule,
    User,
)

router = APIRouter(prefix="/intel", tags=["call-intelligence"])

AUDIO_URL_TTL_SECONDS = 60 * 60


# --- Schemas -------------------------------------------------------------------


class CallRow(BaseModel):
    id: str
    source: str
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
    needs_review: bool = False
    call_type_overridden: bool = False
    # Steps the two scoring models still disagree on and no manager has ruled on.
    disputed_steps: int = 0
    rep_locked: bool = False


class CallPage(BaseModel):
    items: list[CallRow]
    total: int


class DuplicateOut(BaseModel):
    filename: str
    call_id: str


class UploadResult(BaseModel):
    created: list[CallRow]
    duplicates: list[DuplicateOut]


class AnalysisOut(BaseModel):
    model: str
    scoring_mode: str
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
    green_at: int | None = None
    grade: str | None
    evidence_verified_pct: float | None
    triage: dict[str, Any]
    items: list[dict[str, Any]]
    coaching: dict[str, Any]
    cost_usd: float


class FollowUpOut(BaseModel):
    id: str
    call_id: str
    action: str
    owner: str | None
    due: str | None
    status: str
    done_at: datetime | None
    done_by: str | None
    created_at: datetime
    customer: str | None = None
    rep: str | None = None
    ref: str | None = None
    assignee_id: str | None = None
    assignee: str | None = None


class TeamMember(BaseModel):
    id: str
    email: str


class CallDetailOut(CallRow):
    follow_ups: list[FollowUpOut]
    recording_expires_at: datetime | None
    stt_engine: str | None
    stt_provider: str | None
    audio_channels: int | None
    audio_url: str | None
    segments: list[dict[str, Any]]
    analysis: AnalysisOut | None
    provider_log: list[dict[str, Any]]
    cost_usd: float
    transcript_edited_at: datetime | None = None
    # A manager fixed the transcript after this grade was made.
    transcript_stale: bool = False


class ReprocessRequest(BaseModel):
    # keep: re-run analysis on the stored transcript. redo: transcribe again.
    transcript: str = "keep"
    engine: str | None = None
    # A manager's correction of the call type; "" clears a previous one.
    call_type: str | None = None
    # standard | enhanced for this re-score; omitted keeps the call's setting.
    scoring_mode: str | None = None


class LeadOut(BaseModel):
    id: str
    name: str
    stage: str
    stage_source: str
    pests: list[str]
    service: str | None
    price_quoted: str | None
    next_step: str | None
    rep_name: str | None
    last_call_id: str | None
    last_contact_at: datetime | None
    calls: int


class LeadUpdate(BaseModel):
    stage: str


# --- Helpers -------------------------------------------------------------------


def _sign(call_id: str, expires: int) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, f"audio:{call_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def _audio_url(call: Call) -> str | None:
    if pipeline.audio_file(call) is None:
        return None
    expires = int(time.time()) + AUDIO_URL_TTL_SECONDS
    return f"/intel/calls/{call.id}/audio?expires={expires}&sig={_sign(str(call.id), expires)}"


def _row(call: Call) -> CallRow:
    analysis = call.analysis
    return CallRow(
        id=str(call.id),
        source=call.source,
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
        needs_review=bool(
            analysis
            and not call.call_type_override
            and float(analysis.call_type_confidence or 0) < insights.REVIEW_CONFIDENCE
        ),
        call_type_overridden=bool(call.call_type_override),
        disputed_steps=insights.disputed_steps(analysis.items or []) if analysis else 0,
        rep_locked=call.rep_locked,
    )


def _analysis_out(a: CallAnalysis) -> AnalysisOut:
    scorecard = SCORECARDS.get(a.scorecard_key or "")
    return AnalysisOut(
        model=a.model,
        scoring_mode=a.scoring_mode,
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
        green_at=scorecard.green_at if scorecard else None,
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
    if (
        call is None
        or call.business_id != business_id
        or not (call.audio_path or call.stt_provider)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "call not found")
    return call


def _base_query(business_id: uuid.UUID) -> Select[Any]:
    # Every call with a recording (uploads and the receptionist's calls), and
    # calls whose recording has since expired but whose analysis remains.
    return select(Call).where(
        Call.business_id == business_id,
        or_(Call.audio_path.isnot(None), Call.stt_provider.isnot(None)),
    )


# --- Routes --------------------------------------------------------------------


@router.post("/uploads", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
async def upload(
    session: SessionDep,
    business: BusinessDep,
    files: Annotated[list[UploadFile], File(description="One or more call recordings")],
    engine: Annotated[str, Form()] = "",
    scoring: Annotated[str, Form()] = "",
    # JSON list of ISO datetimes, one per file (the browser sends each file's
    # own modified time, which for call exports is when the call happened).
    dates: Annotated[str, Form()] = "",
) -> UploadResult:
    try:
        occurred = [_parse_when(d) for d in json.loads(dates)] if dates else []
    except (ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "dates must be a JSON list") from exc
    if scoring and scoring not in {"standard", "enhanced"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "scoring must be standard or enhanced")
    engine = engine or get_settings().call_stt_engine
    if engine not in {e.value for e in Engine}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "engine must be auto, deepgram or local")

    created: list[Call] = []
    duplicates: list[DuplicateOut] = []
    for index, upload_file in enumerate(files):
        try:
            call = await ingest.ingest(
                session,
                business_id=business.id,
                filename=upload_file.filename or "recording",
                data=await upload_file.read(),
                engine=engine,
                occurred_at=occurred[index] if index < len(occurred) else None,
            )
            call.scoring_mode = scoring or None
        except ingest.DuplicateUpload as exc:
            # Skipped, not fatal: re-uploading a folder shouldn't score calls twice.
            duplicates.append(
                DuplicateOut(filename=upload_file.filename or "recording",
                             call_id=str(exc.existing.id))
            )
            continue
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
    if created:
        jobs.notify()
    return UploadResult(created=[_row(c) for c in created], duplicates=duplicates)


def _when() -> Any:
    return func.coalesce(Call.occurred_at, Call.created_at)


_SORTS: dict[str, Any] = {
    "date": _when,
    "score": lambda: Call.score * 1.0 / func.nullif(Call.score_max, 0),
    "length": lambda: Call.duration_seconds,
    "rep": lambda: select(Rep.name).where(Rep.id == Call.rep_id).scalar_subquery(),
    "type": lambda: Call.call_type,
}


def _order(sort: str, order: str) -> list[Any]:
    column = _SORTS[sort]()
    primary = column.asc().nulls_last() if order == "asc" else column.desc().nulls_last()
    return [primary, _when().desc(), Call.external_ref.desc()]


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
    source: str | None = None,
    review: bool = False,
    disputed: bool = False,
    days: Annotated[int | None, Query(ge=1)] = None,
    sort: str = "date",
    order: str = "desc",
    limit: Annotated[int, Query(le=200)] = 50,
    offset: int = 0,
) -> CallPage:
    if sort not in _SORTS or order not in {"asc", "desc"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown sort")
    stmt = _base_query(business.id)
    if source:
        stmt = stmt.where(Call.source == source)
    if review:
        stmt = stmt.join(CallAnalysis, CallAnalysis.call_id == Call.id).where(
            Call.call_type_override.is_(None),
            CallAnalysis.call_type_confidence < insights.REVIEW_CONFIDENCE,
        )
    if disputed:
        stmt = stmt.where(
            Call.id.in_(
                select(CallAnalysis.call_id).where(
                    func.jsonb_path_exists(
                        CallAnalysis.items, cast(insights.DISPUTED_PATH, JSONPATH)
                    )
                )
            )
        )
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
    if days:
        stmt = stmt.where(_when() >= datetime.now(UTC) - timedelta(days=days))
    if q:
        pattern = f"%{q}%"
        if not review:
            stmt = stmt.outerjoin(CallAnalysis, CallAnalysis.call_id == Call.id)
        stmt = stmt.where(
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
            .order_by(*_order(sort, order))
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return CallPage(items=[_row(c) for c in rows], total=int(total or 0))


@router.get("/calls/{call_id}", response_model=CallDetailOut)
async def get_call(call_id: uuid.UUID, session: SessionDep, business: BusinessDep) -> CallDetailOut:
    call = await _owned_call(session, business.id, call_id)
    follow_ups = (
        await session.scalars(
            select(FollowUp).where(FollowUp.call_id == call.id).order_by(FollowUp.created_at)
        )
    ).all()
    return CallDetailOut(
        **_row(call).model_dump(),
        follow_ups=[_follow_up_out(f) for f in follow_ups],
        recording_expires_at=call.recording_expires_at,
        stt_engine=call.stt_engine,
        stt_provider=call.stt_provider,
        audio_channels=call.audio_channels,
        audio_url=_audio_url(call),
        segments=call.segments or [],
        analysis=_analysis_out(call.analysis) if call.analysis else None,
        provider_log=call.provider_log or [],
        cost_usd=round(float(call.cost_usd or 0), 6),
        transcript_edited_at=call.transcript_edited_at,
        transcript_stale=bool(
            call.transcript_edited_at
            and call.analysis
            and call.transcript_edited_at > call.analysis.updated_at
        ),
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
    if payload.call_type is not None:
        if payload.call_type and payload.call_type not in {t.value for t in CallType}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown call type")
        call.call_type_override = payload.call_type or None
        if (
            payload.call_type
            and payload.call_type == call.call_type
            and payload.engine is None
            and call.analysis is not None
        ):
            # Confirming the type it already has: nothing to re-grade.
            await session.commit()
            return _row(call)
    if payload.scoring_mode is not None:
        if payload.scoring_mode not in {"standard", "enhanced"}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown scoring mode")
        call.scoring_mode = payload.scoring_mode
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


@router.get("/overview")
async def overview(
    session: SessionDep, business: BusinessDep, days: int | None = None
) -> dict[str, Any]:
    """Scorecard, the sales / retention / service lenses, and what to train on."""
    data = await insights.overview(session, business.id, days)
    data["receptionist_number"] = business.twilio_number
    return data


@router.get("/v2/brief")
async def owner_brief(
    session: SessionDep, business: BusinessDep, days: int | None = None
) -> dict[str, Any]:
    """What is happening, whether it is good, what matters, and what to do next."""
    data = await brief.brief(session, business.id, days)
    data["receptionist_number"] = business.twilio_number
    return data


@router.get("/v2/pipeline")
async def owner_pipeline(session: SessionDep, business: BusinessDep) -> dict[str, Any]:
    """Open leads with the next action for whoever works the pipeline."""
    return await brief.pipeline(session, business.id)


@router.get("/v2/reps")
async def owner_reps(
    session: SessionDep, business: BusinessDep, days: int | None = None
) -> list[dict[str, Any]]:
    return await brief.reps(session, business.id, days)


@router.get("/v2/reps/{rep_id}")
async def owner_rep(
    rep_id: uuid.UUID, session: SessionDep, business: BusinessDep, days: int | None = None
) -> dict[str, Any]:
    detail = await brief.rep_brief(session, business.id, rep_id, days)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rep not found")
    return detail


@router.get("/reps")
async def list_reps(
    session: SessionDep, business: BusinessDep, days: int | None = None
) -> list[dict[str, Any]]:
    return await insights.reps(session, business.id, days)


@router.get("/reps/{rep_id}")
async def get_rep(
    rep_id: uuid.UUID, session: SessionDep, business: BusinessDep, days: int | None = None
) -> dict[str, Any]:
    detail = await insights.rep_detail(session, business.id, rep_id, days)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rep not found")
    return detail


@router.get("/pipeline", response_model=list[LeadOut])
async def pipeline_board(session: SessionDep, business: BusinessDep) -> list[LeadOut]:
    rows = (
        await session.execute(
            select(Lead, Rep.name, func.count(Call.id))
            .outerjoin(Rep, Rep.id == Lead.rep_id)
            .outerjoin(Call, Call.lead_id == Lead.id)
            .where(Lead.business_id == business.id)
            .group_by(Lead.id, Rep.name)
            .order_by(Lead.last_contact_at.desc().nullslast())
        )
    ).all()
    return [
        LeadOut(
            id=str(lead.id), name=lead.name, stage=lead.stage, stage_source=lead.stage_source,
            pests=list(lead.pests or []), service=lead.service, price_quoted=lead.price_quoted,
            next_step=lead.next_step, rep_name=rep_name,
            last_call_id=str(lead.last_call_id) if lead.last_call_id else None,
            last_contact_at=lead.last_contact_at, calls=int(n),
        )
        for lead, rep_name, n in rows
    ]


@router.patch("/leads/{lead_id}", response_model=dict[str, str])
async def move_lead(
    lead_id: uuid.UUID, payload: LeadUpdate, session: SessionDep, business: BusinessDep
) -> dict[str, str]:
    lead = await session.get(Lead, lead_id)
    if lead is None or lead.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "lead not found")
    if payload.stage not in leads_service.STAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown stage")
    lead.stage = payload.stage
    lead.stage_source = "manual"
    await session.commit()
    return {"id": str(lead.id), "stage": lead.stage}



def _parse_when(value: Any) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone required")
    # A file dated in the future or before phones existed is a bad clock, not a call date.
    if parsed > datetime.now(UTC) + timedelta(days=1) or parsed.year < 2000:
        return None
    return parsed


class CallUpdate(BaseModel):
    occurred_at: datetime | None = None
    # An existing rep's id, or a new name; "" clears a manual assignment.
    rep_id: str | None = None
    rep_name: str | None = Field(default=None, max_length=120)


@router.patch("/calls/{call_id}", response_model=CallRow)
async def update_call(
    call_id: uuid.UUID, payload: CallUpdate, session: SessionDep, business: BusinessDep
) -> CallRow:
    """Correct when a call happened, or who took it."""
    call = await _owned_call(session, business.id, call_id)
    if payload.occurred_at is not None:
        if payload.occurred_at.tzinfo is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "occurred_at needs a timezone")
        call.occurred_at = payload.occurred_at
    if payload.rep_id is not None or payload.rep_name is not None:
        await _assign_rep(session, business.id, call, payload)
    await session.flush()
    await session.refresh(call, ["rep"])
    if call.lead_id:
        await leads_service.refresh_contact(session, call.lead_id)
    await session.commit()
    return _row(call)


async def _assign_rep(
    session: Any, business_id: uuid.UUID, call: Call, payload: CallUpdate
) -> None:
    if payload.rep_name and payload.rep_name.strip():
        rep = await pipeline.get_or_create_rep(session, business_id, payload.rep_name)
        if rep is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "rep name is empty")
        call.rep_id, call.rep_locked = rep.id, True
    elif payload.rep_id:
        try:
            rep_uuid = uuid.UUID(payload.rep_id)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid rep_id") from exc
        rep = await session.get(Rep, rep_uuid)
        if rep is None or rep.business_id != business_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "rep not found")
        call.rep_id, call.rep_locked = rep.id, True
    else:
        # Back to the rep the analysis identified.
        call.rep_locked = False
        name = call.analysis.rep_name if call.analysis else None
        if call.source == "twilio":
            name = pipeline.AI_REP_NAME
        rep = await pipeline.get_or_create_rep(session, business_id, name or "")
        call.rep_id = rep.id if rep else None


def _follow_up_out(f: FollowUp, call: Call | None = None) -> FollowUpOut:
    analysis = call.analysis if call else None
    return FollowUpOut(
        id=str(f.id), call_id=str(f.call_id), action=f.action, owner=f.owner, due=f.due,
        status=f.status, done_at=f.done_at, done_by=f.done_by, created_at=f.created_at,
        customer=analysis.customer_name if analysis else None,
        rep=(call.rep.name if call and call.rep else None),
        ref=call.external_ref if call else None,
        assignee_id=str(f.assignee_id) if f.assignee_id else None,
        assignee=f.assignee.email if f.assignee else None,
    )


@router.get("/follow-ups", response_model=list[FollowUpOut])
async def list_follow_ups(
    session: SessionDep,
    business: BusinessDep,
    status_: Annotated[str, Query(alias="status")] = "open",
) -> list[FollowUpOut]:
    rows = (
        await session.execute(
            select(FollowUp, Call)
            .join(Call, Call.id == FollowUp.call_id)
            .where(FollowUp.business_id == business.id, FollowUp.status == status_)
            .options(selectinload(Call.analysis), selectinload(Call.rep))
            .order_by(FollowUp.created_at.desc())
            .limit(200)
        )
    ).all()
    return [_follow_up_out(f, c) for f, c in rows]


class FollowUpUpdate(BaseModel):
    status: str | None = None
    # A team member's id; "" unassigns.
    assignee_id: str | None = None


@router.get("/team", response_model=list[TeamMember])
async def team(session: SessionDep, business: BusinessDep) -> list[TeamMember]:
    """Who follow-ups can be assigned to."""
    users = await session.scalars(
        select(User).where(User.business_id == business.id).order_by(User.email)
    )
    return [TeamMember(id=str(u.id), email=u.email) for u in users]


@router.patch("/follow-ups/{follow_up_id}", response_model=FollowUpOut)
async def update_follow_up(
    follow_up_id: uuid.UUID, payload: FollowUpUpdate, session: SessionDep,
    business: BusinessDep, user: UserDep,
) -> FollowUpOut:
    item = await session.get(FollowUp, follow_up_id)
    if item is None or item.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "follow-up not found")
    if payload.status is not None:
        if payload.status not in (followups.OPEN, followups.DONE):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "status must be open or done")
        item.status = payload.status
        item.done_at = datetime.now(UTC) if payload.status == followups.DONE else None
        item.done_by = user.email if payload.status == followups.DONE else None
    if payload.assignee_id is not None:
        if payload.assignee_id == "":
            item.assignee_id = None
        else:
            try:
                assignee = await session.get(User, uuid.UUID(payload.assignee_id))
            except ValueError as exc:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid assignee_id") from exc
            if assignee is None or assignee.business_id != business.id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "team member not found")
            item.assignee_id = assignee.id
    await session.commit()
    await session.refresh(item, ["assignee"])
    return _follow_up_out(item)


class OverrideRequest(BaseModel):
    # met | missed, or null to clear the override.
    status: str | None
    note: str = Field(default="", max_length=500)
    # Also grade this step this way on future calls, in the manager's words.
    rule: str | None = Field(default=None, max_length=scoring_rules.MAX_TEXT)


@router.put("/calls/{call_id}/items/{key}/override", response_model=CallRow)
async def override_item(
    call_id: uuid.UUID, key: str, payload: OverrideRequest, session: SessionDep,
    business: BusinessDep, user: UserDep,
) -> CallRow:
    """A manager's correction to one scorecard step. The grade is recomputed."""
    call = await _owned_call(session, business.id, call_id)
    analysis = call.analysis
    if analysis is None or not any(i.get("key") == key for i in analysis.items or []):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "step not found")
    if payload.status not in (None, "met", "missed"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "status must be met, missed or null")

    current = dict(analysis.overrides or {})
    if payload.status is None:
        current.pop(key, None)
    else:
        current[key] = {
            "status": payload.status,
            "note": payload.note.strip(),
            "by": user.email,
            "at": datetime.now(UTC).isoformat(),
            # Step keys repeat across scorecards with different criteria, so a
            # ruling only holds on the scorecard it was made against.
            "scorecard": analysis.scorecard_key,
        }
    items, score, grade = overrides.apply(analysis.items or [], current, analysis.scorecard_key)
    analysis.overrides = current
    analysis.items = items
    analysis.score, analysis.grade = score, grade
    call.score, call.grade = score, grade
    rule = " ".join((payload.rule or "").split())
    if payload.status is not None and rule and analysis.scorecard_key:
        session.add(ScoringRule(
            business_id=business.id, scorecard_key=analysis.scorecard_key, step_key=key,
            text=rule, created_by=user.email, source_call_id=call.id,
        ))
    await session.commit()
    return _row(call)


# --- Scoring rules ---------------------------------------------------------------


class RuleOut(BaseModel):
    id: str
    scorecard_key: str
    scorecard_name: str
    step_key: str
    step_label: str
    text: str
    active: bool
    created_by: str | None
    created_at: datetime
    source_call_id: str | None


class RescoreScope(BaseModel):
    scorecard_key: str
    scorecard_name: str
    calls: int
    # What re-scoring them all costs at this business's recent per-call cost.
    est_cost_usd: float


class RulesOut(BaseModel):
    rules: list[RuleOut]
    rescore: list[RescoreScope]


class RuleUpdate(BaseModel):
    active: bool | None = None
    text: str | None = Field(default=None, max_length=scoring_rules.MAX_TEXT)


class RescoreRequest(BaseModel):
    # One scorecard, or every scorecard that has a rule.
    scorecard_key: str | None = None


def _rule_out(r: ScoringRule) -> RuleOut:
    card = SCORECARDS.get(r.scorecard_key)
    item = card.item(r.step_key) if card else None
    return RuleOut(
        id=str(r.id), scorecard_key=r.scorecard_key,
        scorecard_name=card.name if card else r.scorecard_key,
        step_key=r.step_key, step_label=item.label if item else r.step_key,
        text=r.text, active=r.active, created_by=r.created_by, created_at=r.created_at,
        source_call_id=str(r.source_call_id) if r.source_call_id else None,
    )


def _rescorable(business_id: uuid.UUID, keys: list[str]) -> Select[Any]:
    """Graded calls on these scorecards that can be scored again now."""
    return (
        select(CallAnalysis.scorecard_key, func.count(), func.avg(CallAnalysis.cost_usd))
        .join(Call, Call.id == CallAnalysis.call_id)
        .where(
            CallAnalysis.business_id == business_id,
            CallAnalysis.scorecard_key.in_(keys),
            Call.processing_status == ProcessingStatus.DONE,
            Call.segments != [],
        )
        .group_by(CallAnalysis.scorecard_key)
    )


@router.get("/rules", response_model=RulesOut)
async def list_rules(session: SessionDep, business: BusinessDep) -> RulesOut:
    rows = list(await session.scalars(
        select(ScoringRule).where(ScoringRule.business_id == business.id)
        .order_by(ScoringRule.created_at.desc())
    ))
    keys = sorted({r.scorecard_key for r in rows if r.active})
    scopes = []
    if keys:
        for key, count, avg in (await session.execute(_rescorable(business.id, keys))).all():
            card = SCORECARDS.get(key)
            scopes.append(RescoreScope(
                scorecard_key=key, scorecard_name=card.name if card else key, calls=int(count),
                est_cost_usd=round(float(avg or 0) * int(count), 2),
            ))
    return RulesOut(rules=[_rule_out(r) for r in rows], rescore=scopes)


async def _owned_rule(
    session: SessionDep, business_id: uuid.UUID, rule_id: uuid.UUID
) -> ScoringRule:
    rule = await session.get(ScoringRule, rule_id)
    if rule is None or rule.business_id != business_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return rule


@router.patch("/rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: uuid.UUID, payload: RuleUpdate, session: SessionDep, business: BusinessDep
) -> RuleOut:
    rule = await _owned_rule(session, business.id, rule_id)
    if payload.text is not None:
        text = " ".join(payload.text.split())
        if not text:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "rule text is empty")
        rule.text = text
    if payload.active is not None:
        rule.active = payload.active
    await session.commit()
    return _rule_out(rule)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: uuid.UUID, session: SessionDep, business: BusinessDep) -> None:
    await session.delete(await _owned_rule(session, business.id, rule_id))
    await session.commit()


@router.post("/rules/rescore", response_model=dict[str, int])
async def rescore_with_rules(
    payload: RescoreRequest, session: SessionDep, business: BusinessDep
) -> dict[str, int]:
    """Grade past calls again so they follow the current rules. Transcripts
    are kept; a manager's own step rulings still sit on top."""
    if payload.scorecard_key:
        keys = [payload.scorecard_key]
    else:
        keys = sorted(set(await session.scalars(
            select(ScoringRule.scorecard_key).where(
                ScoringRule.business_id == business.id, ScoringRule.active.is_(True)
            )
        )))
    if not keys:
        return {"queued": 0}
    graded = select(CallAnalysis.call_id).where(
        CallAnalysis.business_id == business.id, CallAnalysis.scorecard_key.in_(keys)
    )
    # Only finished calls: one already in the queue keeps its place.
    result = await session.execute(
        update(Call)
        .where(
            Call.business_id == business.id,
            Call.id.in_(graded),
            Call.processing_status == ProcessingStatus.DONE,
            Call.segments != [],
        )
        .values(processing_status=pipeline.QUEUED_ANALYSIS, processing_error=None)
    )
    await session.commit()
    jobs.notify()
    return {"queued": int(getattr(result, "rowcount", 0) or 0)}


# --- Transcript fixes ------------------------------------------------------------


class TranscriptEdit(BaseModel):
    # text | role | split | insert | delete
    op: str
    id: int | None = None
    text: str | None = Field(default=None, max_length=transcript_edit.MAX_TEXT)
    role: str | None = None
    # split: character offset in the line where the other person starts.
    at: int | None = None
    # split / insert: seconds into the recording.
    start: float | None = None


@router.post("/calls/{call_id}/transcript", response_model=CallDetailOut)
async def edit_transcript(
    call_id: uuid.UUID, payload: TranscriptEdit, session: SessionDep, business: BusinessDep
) -> CallDetailOut:
    """Fix one line of a transcript. The grade isn't changed until the call is
    scored again, so the manager can make several fixes first."""
    call = await _owned_call(session, business.id, call_id)
    if call.processing_status != ProcessingStatus.DONE and call.processing_status != (
        ProcessingStatus.FAILED
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "call is being processed")
    segments = [Segment.from_dict(s) for s in call.segments or []]
    try:
        if payload.op == "text" and payload.id is not None and payload.text is not None:
            segments = transcript_edit.set_text(segments, payload.id, payload.text)
        elif payload.op == "role" and payload.id is not None and payload.role:
            segments = transcript_edit.set_role(segments, payload.id, payload.role)
        elif payload.op == "split" and payload.id is not None and payload.at is not None:
            segments = transcript_edit.split(
                segments, payload.id, payload.at, payload.role or "", payload.start
            )
        elif payload.op == "insert" and payload.start is not None and payload.text:
            segments = transcript_edit.insert(segments, payload.start, payload.role or "",
                                              payload.text)
        elif payload.op == "delete" and payload.id is not None:
            segments = transcript_edit.delete(segments, payload.id)
        else:
            raise transcript_edit.EditError("unknown or incomplete edit")
    except transcript_edit.EditError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    call.segments = [s.to_dict() for s in segments]
    call.transcript = plain_text(segments)
    call.transcript_edited_at = datetime.now(UTC)
    await session.commit()
    return await get_call(call.id, session, business)
