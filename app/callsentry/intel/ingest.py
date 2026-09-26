"""Store an uploaded recording and queue it for processing."""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.config import get_settings
from callsentry.intel import audio, pipeline
from callsentry.models import Call, CallSource, ProcessingStatus

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


class RejectedUpload(ValueError):
    pass


class DuplicateUpload(RejectedUpload):
    def __init__(self, name: str, existing: Call) -> None:
        super().__init__(f"{name}: already uploaded")
        self.existing = existing


def fingerprint(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def find_duplicate(
    session: AsyncSession, business_id: uuid.UUID, digest: str
) -> Call | None:
    return await session.scalar(
        select(Call).where(Call.business_id == business_id, Call.audio_sha256 == digest).limit(1)
    )


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
    occurred_at: datetime | None = None,
) -> Call:
    name = Path(filename or "recording").name
    suffix = Path(name).suffix.lower()
    if suffix not in audio.AUDIO_EXTENSIONS:
        raise RejectedUpload(f"{name}: not a supported audio file")
    if not data:
        raise RejectedUpload(f"{name}: file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise RejectedUpload(f"{name}: larger than {MAX_UPLOAD_BYTES // 1024 // 1024} MB")

    digest = fingerprint(data)
    existing = await find_duplicate(session, business_id, digest)
    if existing is not None:
        raise DuplicateUpload(name, existing)

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
        audio_sha256=digest,
        duration_seconds=int(round(info.duration_seconds)),
        processing_status=ProcessingStatus.QUEUED,
        occurred_at=occurred_at,
        # Stamped once: a later policy change never shortens what was promised.
        recording_expires_at=datetime.now(UTC)
        + timedelta(days=get_settings().recording_retention_days),
        stt_engine=engine,
        segments=[],
        provider_log=[],
    )
    session.add(call)
    await session.flush()
    return call


async def backfill_fingerprints(session: AsyncSession) -> int:
    """Fingerprint uploads stored before fingerprints were recorded."""
    calls = (
        await session.scalars(
            select(Call).where(
                Call.source == CallSource.UPLOAD,
                Call.audio_sha256.is_(None),
                Call.audio_path.isnot(None),
            )
        )
    ).all()
    done = 0
    for call in calls:
        path = pipeline.audio_file(call)
        if path is None or not path.exists():
            continue
        call.audio_sha256 = fingerprint(path.read_bytes())
        done += 1
    await session.commit()
    return done
