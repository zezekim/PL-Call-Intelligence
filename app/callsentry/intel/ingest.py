"""Store an uploaded recording and queue it for processing."""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.intel import audio, pipeline
from callsentry.models import Call, CallSource, ProcessingStatus

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


class RejectedUpload(ValueError):
    pass


def external_ref(filename: str) -> str | None:
    """'CALL 014.mp3' -> 'CALL-014'. Only when the name looks like a reference."""
    stem = Path(filename).stem.strip()
    match = re.fullmatch(r"([A-Za-z]+)[\s_-]*(\d+)", stem)
    return f"{match.group(1).upper()}-{match.group(2)}" if match else None


async def ingest(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    filename: str,
    data: bytes,
    engine: str,
) -> Call:
    name = Path(filename or "recording").name
    suffix = Path(name).suffix.lower()
    if suffix not in audio.AUDIO_EXTENSIONS:
        raise RejectedUpload(f"{name}: not a supported audio file")
    if not data:
        raise RejectedUpload(f"{name}: file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise RejectedUpload(f"{name}: larger than {MAX_UPLOAD_BYTES // 1024 // 1024} MB")

    call_id = uuid.uuid4()
    directory = pipeline.upload_root() / str(business_id)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{call_id}{suffix}"
    path.write_bytes(data)
    try:
        info = await audio.probe(path)
    except audio.AudioError as exc:
        path.unlink(missing_ok=True)
        raise RejectedUpload(f"{name}: could not read audio") from exc

    call = Call(
        id=call_id,
        business_id=business_id,
        caller_number="",
        source=CallSource.UPLOAD,
        external_ref=external_ref(name),
        original_filename=name,
        audio_path=f"{business_id}/{call_id}{suffix}",
        audio_channels=info.channels,
        duration_seconds=int(round(info.duration_seconds)),
        processing_status=ProcessingStatus.QUEUED,
        stt_engine=engine,
        segments=[],
        provider_log=[],
    )
    session.add(call)
    await session.flush()
    return call
