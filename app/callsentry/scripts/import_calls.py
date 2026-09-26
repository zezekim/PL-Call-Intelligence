"""Queue a folder of call recordings for processing.

    python -m callsentry.scripts.import_calls /path/to/recordings \
        [--email demo@callsentry.local] [--engine auto|deepgram|local]

The running API's job runner picks the calls up. Recordings are copied into
UPLOAD_DIR; the source folder is not modified.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from sqlalchemy import select

from callsentry.core.db import get_sessionmaker
from callsentry.intel import audio, ingest
from callsentry.models import Call, CallSource, User


async def main(folder: Path, email: str, engine: str, skip_existing: bool) -> None:
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in audio.AUDIO_EXTENSIONS)
    if not files:
        raise SystemExit(f"no audio files in {folder}")

    async with get_sessionmaker()() as session:
        user = await session.scalar(select(User).where(User.email == email))
        if user is None:
            raise SystemExit(f"no user {email} - run the seed first")
        existing = set(
            (
                await session.scalars(
                    select(Call.original_filename).where(
                        Call.business_id == user.business_id, Call.source == CallSource.UPLOAD
                    )
                )
            ).all()
        )
        queued = 0
        for path in files:
            if skip_existing and path.name in existing:
                print(f"skip   {path.name} (already imported)")
                continue
            call = await ingest.ingest(
                session,
                business_id=user.business_id,
                filename=path.name,
                data=path.read_bytes(),
                engine=engine,
            )
            queued += 1
            print(f"queued {path.name} -> {call.external_ref or call.id}")
        await session.commit()
    print(f"{queued} recording(s) queued")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--email", default="demo@callsentry.local")
    parser.add_argument("--engine", default="auto", choices=["auto", "deepgram", "local"])
    parser.add_argument("--all", action="store_true", help="re-import files already imported")
    args = parser.parse_args()
    asyncio.run(main(args.folder, args.email, args.engine, skip_existing=not args.all))
