"""Create the business and its first admin user.

    SEED_BUSINESS_NAME   default "ABC Pest Control"
    SEED_ADMIN_EMAIL     default "admin@pestlaunch.local"
    SEED_ADMIN_PASSWORD  default: a random password, printed once

Idempotent: re-running only fills in what is missing.
"""

from __future__ import annotations

import asyncio
import os
import secrets

from sqlalchemy import select

from callsentry import logging as app_logging
from callsentry.config import get_settings
from callsentry.core.db import get_sessionmaker
from callsentry.core.security import hash_password
from callsentry.models import Business, User, UserRole
from callsentry.models.business import DEFAULT_HOURS


async def main() -> None:
    app_logging.configure(get_settings().log_level)
    name = os.getenv("SEED_BUSINESS_NAME", "ABC Pest Control")
    email = os.getenv("SEED_ADMIN_EMAIL", "admin@pestlaunch.local")
    password = os.getenv("SEED_ADMIN_PASSWORD") or secrets.token_urlsafe(12)

    async with get_sessionmaker()() as session:
        business = await session.scalar(select(Business).limit(1))
        if business is None:
            business = Business(
                name=name,
                timezone="America/Chicago",
                business_hours=dict(DEFAULT_HOURS),
                voice_id="af_heart",
            )
            session.add(business)
            await session.flush()
            print(f"Created business: {business.name}")

        if await session.scalar(select(User).where(User.email == email)) is None:
            session.add(
                User(
                    business_id=business.id,
                    email=email,
                    password_hash=hash_password(password),
                    role=UserRole.ADMIN,
                )
            )
            print(f"Created admin: {email} / {password}")
        else:
            print(f"Admin {email} already exists")

        await session.commit()


if __name__ == "__main__":
    asyncio.run(main())
