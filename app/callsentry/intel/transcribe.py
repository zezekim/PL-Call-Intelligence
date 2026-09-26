"""Speaker-separated transcription of a call recording.

Two engines, selectable per upload:

  deepgram : Nova-3 with diarization (mono) or per-channel transcription
             (stereo). Best at telling the rep from the customer.
  local    : faster-whisper in the worker container. Stereo recordings are
             transcribed one channel at a time, which separates speakers
             exactly; mono recordings come back without speaker labels and
             are attributed afterwards from the conversation itself.

`auto` tries Deepgram and falls back to local. Both go through the provider
registry, so every attempt lands on the call's provider_log. There is no mock
tier here: an empty transcript would produce a confident-looking score of
nothing, which is worse than a visible failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

import httpx
import structlog

from callsentry.config import get_settings
from callsentry.core.providers import Attempt, Component, ProviderSpec, get_registry
from callsentry.intel import audio
from callsentry.intel.transcript import Segment, renumber

log = structlog.get_logger(__name__)

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_PER_MINUTE = 0.0043


class Engine(StrEnum):
    AUTO = "auto"
    DEEPGRAM = "deepgram"
    LOCAL = "local"


ENGINE_ORDER: dict[str, list[str]] = {
    Engine.AUTO: ["deepgram", "whisper.cpp"],
    Engine.DEEPGRAM: ["deepgram"],
    Engine.LOCAL: ["whisper.cpp"],
}


@dataclass
class Transcription:
    segments: list[Segment]
    provider: str
    tier: str
    # True when segments carry real speaker labels (diarization or channels).
    diarized: bool
    duration_seconds: float
    cost_usd: float = 0.0
    attempts: list[Attempt] = field(default_factory=list)


def parse_deepgram(data: dict[str, Any], *, multichannel: bool) -> list[Segment]:
    """Deepgram `utterances` -> segments. Speaker is the channel on stereo."""
    segments: list[Segment] = []
    for utt in (data.get("results") or {}).get("utterances") or []:
        text = str(utt.get("transcript") or "").strip()
        if not text:
            continue
        speaker = f"ch{utt.get('channel', 0)}" if multichannel else str(utt.get("speaker", 0))
        segments.append(
            Segment(
                id=0,
                start=float(utt.get("start", 0.0)),
                end=float(utt.get("end", 0.0)),
                text=text,
                speaker=speaker,
            )
        )
    return renumber(segments)


async def _deepgram(path: Path, info: audio.AudioInfo) -> Transcription:
    settings = get_settings()
    multichannel = info.channels >= 2
    params = {
        "model": settings.deepgram_model,
        "smart_format": "true",
        "punctuate": "true",
        "utterances": "true",
        # Split turns at shorter pauses than the default so a quick
        # back-and-forth isn't merged into one utterance.
        "utt_split": "0.8",
    }
    if multichannel:
        params["multichannel"] = "true"
    else:
        params["diarize"] = "true"

    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=15.0)) as client:
        resp = await client.post(
            DEEPGRAM_URL,
            params=params,
            headers={
                "Authorization": f"Token {settings.deepgram_api_key}",
                "Content-Type": audio.content_type(path),
            },
            content=path.read_bytes(),
        )
        resp.raise_for_status()
        data = resp.json()

    segments = parse_deepgram(data, multichannel=multichannel)
    duration = float((data.get("metadata") or {}).get("duration") or info.duration_seconds)
    channels = max(1, info.channels) if multichannel else 1
    return Transcription(
        segments=segments,
        provider="deepgram",
        tier="cloud",
        diarized=len({s.speaker for s in segments}) > 1,
        duration_seconds=duration,
        cost_usd=round(duration / 60 * DEEPGRAM_PER_MINUTE * channels, 6),
    )


async def _worker_segments(wav: bytes, *, speaker: str) -> list[Segment]:
    settings = get_settings()
    # Offline transcription of a long call on CPU can take minutes.
    async with httpx.AsyncClient(timeout=httpx.Timeout(1800.0, connect=10.0)) as client:
        resp = await client.post(
            f"{settings.worker_base_url}/stt/segments",
            files={"file": ("call.wav", wav, "audio/wav")},
        )
        resp.raise_for_status()
        data = resp.json()
    return [
        Segment(
            id=0,
            start=float(s.get("start", 0.0)),
            end=float(s.get("end", 0.0)),
            text=str(s.get("text", "")).strip(),
            speaker=speaker,
        )
        for s in data.get("segments") or []
    ]


async def _local(path: Path, info: audio.AudioInfo) -> Transcription:
    if info.channels >= 2:
        segments: list[Segment] = []
        for channel in (0, 1):
            wav = await audio.to_wav(path, channel=channel)
            segments.extend(await _worker_segments(wav, speaker=f"ch{channel}"))
        diarized = True
    else:
        segments = await _worker_segments(await audio.to_wav(path), speaker="")
        diarized = False
    return Transcription(
        segments=renumber(segments),
        provider="whisper.cpp",
        tier="local",
        diarized=diarized,
        duration_seconds=info.duration_seconds,
    )


async def transcribe(path: Path, *, engine: str) -> Transcription:
    info = await audio.probe(path)
    attempts: list[Attempt] = []

    async def deepgram(_: ProviderSpec) -> Transcription:
        return await _deepgram(path, info)

    async def local(_: ProviderSpec) -> Transcription:
        return await _local(path, info)

    order = ENGINE_ORDER.get(engine, ENGINE_ORDER[Engine.AUTO])
    handlers = {"deepgram": deepgram, "whisper.cpp": local}
    result, _spec = await get_registry().run(
        Component.STT,
        {name: handlers[name] for name in order},
        attempts=attempts,
        order=order,
    )
    if not result.segments:
        raise EmptyTranscript(f"{result.provider} returned no speech")
    result.attempts = attempts
    return result


class EmptyTranscript(RuntimeError):
    pass
