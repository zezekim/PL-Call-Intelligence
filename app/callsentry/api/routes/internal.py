"""Endpoints consumed only by the Pipecat voice container.

Guarded by INTERNAL_API_TOKEN. These are not part of the public API surface
and are excluded from the OpenAPI schema.
"""

from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel

from callsentry.agents import voice_agent
from callsentry.api.deps import InternalDep, SessionDep
from callsentry.config import get_settings
from callsentry.intel import jobs, pipeline
from callsentry.models import Business, Call, CallOutcome, CostCategory, ProcessingStatus
from callsentry.services import callstate, costs

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


class TurnRequest(BaseModel):
    call_id: str
    utterance: str


class TurnResponseOut(BaseModel):
    text: str
    end_call: bool = False
    transfer_to: str | None = None
    voice: str = "af_heart"


class HangupRequest(BaseModel):
    call_id: str
    transcript: str = ""
    duration_seconds: int = 0


async def _load(session: SessionDep, call_id: str) -> tuple[Call, Business]:
    try:
        parsed = uuid.UUID(call_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "malformed call id") from exc

    call = await session.get(Call, parsed)
    if call is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "call not found")
    business = await session.get(Business, call.business_id)
    if business is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "business not found")
    return call, business


@router.post("/turn", response_model=TurnResponseOut)
async def turn(
    payload: TurnRequest, session: SessionDep, _: InternalDep
) -> TurnResponseOut:
    """One caller utterance in, one thing to say out."""
    call, business = await _load(session, payload.call_id)

    state = await callstate.load(payload.call_id)
    if state is None:
        # State expired or the app restarted mid-call. Rebuild rather than
        # dropping the caller; they lose context, not the call.
        state = voice_agent.CallState(
            call_id=payload.call_id,
            business_id=str(business.id),
            caller_number=call.caller_number,
            after_hours=not voice_agent.is_open(business),
        )

    result = await voice_agent.handle_turn(
        session, business=business, call=call, state=state, utterance=payload.utterance
    )

    if result.outcome:
        call.outcome = result.outcome
    if result.escalation_reason:
        call.escalated = True
        call.escalation_reason = result.escalation_reason
    if result.transfer_to:
        # Twilio asks what to do once the stream closes; see webhooks.stream_ended.
        state.transfer_requested = True

    await callstate.save(state)

    return TurnResponseOut(
        text=result.text,
        end_call=result.end_call,
        transfer_to=result.transfer_to,
        voice=business.voice_id,
    )


@router.post("/hangup", status_code=status.HTTP_204_NO_CONTENT)
async def hangup(payload: HangupRequest, session: SessionDep, _: InternalDep) -> None:
    """Call ended: run post-call analysis and settle costs."""
    call, business = await _load(session, payload.call_id)

    if payload.duration_seconds:
        call.duration_seconds = payload.duration_seconds
    if call.outcome == CallOutcome.ANSWERED and not payload.transcript.strip():
        call.outcome = CallOutcome.ABANDONED

    if call.audio_path:
        # Recorded: call intelligence transcribes and scores it, so the older
        # transcript-only analysis would only duplicate the work and the cost.
        call.transcript = call.transcript or payload.transcript
    else:
        await voice_agent.finalize_call(
            session, call=call, business=business, transcript=payload.transcript
        )
    await callstate.clear(payload.call_id)


@router.get("/call/{call_id}/context")
async def call_context(call_id: str, session: SessionDep, _: InternalDep) -> dict[str, str | bool]:
    """Everything Pipecat needs to open the session: greeting, voice, hours."""
    call, business = await _load(session, call_id)
    after_hours = not voice_agent.is_open(business)
    return {
        "business_name": business.name,
        "greeting": voice_agent.opening_line(business, after_hours=after_hours),
        "voice": business.voice_id,
        "after_hours": after_hours,
        "caller_number": call.caller_number,
    }


class SpeakRequest(BaseModel):
    call_id: str
    text: str
    voice: str = "af_heart"


@router.post("/stt")
async def speech_to_text(
    session: SessionDep,
    _: InternalDep,
    call_id: str = Form(...),
    file: UploadFile = File(...),
) -> dict[str, str]:
    """One caller utterance to text, through the provider chain."""
    from callsentry.services.transcription import get_transcription

    call, _business = await _load(session, call_id)
    result = await get_transcription().transcribe(
        await file.read(), filename="turn.wav", prefer_cloud=get_settings().voice_prefer_cloud
    )
    await costs.record(
        session, business_id=call.business_id, call_id=call.id, category=CostCategory.STT,
        provider=result.provider, tier=result.tier, units=result.duration_seconds / 60,
        unit_name="audio_minute", cost_usd=result.cost_usd,
    )
    text = "" if result.tier == "mock" else result.text
    return {"text": text, "provider": result.provider}


@router.post("/tts")
async def text_to_speech(payload: SpeakRequest, session: SessionDep, _: InternalDep) -> Response:
    """A line to say, as WAV audio, through the provider chain."""
    from callsentry.services.tts import get_tts

    call, _business = await _load(session, payload.call_id)
    result = await get_tts().synthesize(
        payload.text, voice=payload.voice, prefer_cloud=get_settings().voice_prefer_cloud
    )
    await costs.record(
        session, business_id=call.business_id, call_id=call.id, category=CostCategory.TTS,
        provider=result.provider, tier=result.tier, units=result.characters / 1000,
        unit_name="1k_chars", cost_usd=result.cost_usd,
    )
    return Response(content=result.audio, media_type=result.mime_type,
                    headers={"X-Provider": result.provider})


@router.post("/recording", status_code=status.HTTP_204_NO_CONTENT)
async def recording(
    session: SessionDep,
    _: InternalDep,
    call_id: str = Form(...),
    file: UploadFile = File(...),
) -> None:
    """Stereo recording of a finished call (agent left, caller right).

    Stored like an upload and queued for call intelligence, so a call to the
    AI receptionist is transcribed and scored like any other call.
    """
    call, _business = await _load(session, call_id)
    data = await file.read()
    if not data:
        return
    directory = pipeline.upload_root() / str(call.business_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{call.id}.wav").write_bytes(data)
    call.audio_path = f"{call.business_id}/{call.id}.wav"
    call.audio_channels = 2
    call.original_filename = "AI receptionist call"
    call.stt_engine = "deepgram" if get_settings().deepgram_api_key else "local"
    call.processing_status = ProcessingStatus.QUEUED
    await session.commit()
    jobs.notify()
