"""ffmpeg/ffprobe helpers for uploaded call recordings."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".oga", ".webm", ".flac", ".aac"}

CONTENT_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
}


class AudioError(RuntimeError):
    pass


@dataclass
class AudioInfo:
    channels: int
    duration_seconds: float
    sample_rate: int


async def _run(*args: str) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise AudioError(err.decode(errors="replace").strip()[-400:] or f"{args[0]} failed")
    return out


async def probe(path: Path) -> AudioInfo:
    out = await _run(
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=channels,sample_rate:format=duration",
        "-of", "json", str(path),
    )
    data = json.loads(out or b"{}")
    streams = data.get("streams") or []
    if not streams:
        raise AudioError("no audio stream found")
    return AudioInfo(
        channels=int(streams[0].get("channels") or 1),
        sample_rate=int(streams[0].get("sample_rate") or 0),
        duration_seconds=float((data.get("format") or {}).get("duration") or 0.0),
    )


async def to_wav(path: Path, *, channel: int | None = None) -> bytes:
    """16 kHz mono PCM WAV - the whole mix, or one channel of a stereo file."""
    mix = ["-ac", "1"] if channel is None else ["-af", f"pan=mono|c0=c{channel}"]
    return await _run(
        "ffmpeg", "-v", "error", "-i", str(path), *mix, "-ar", "16000",
        "-f", "wav", "-",
    )


def content_type(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
