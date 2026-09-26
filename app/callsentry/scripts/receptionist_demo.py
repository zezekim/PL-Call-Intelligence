"""Configure the AI receptionist for the demo business.

    python -m callsentry.scripts.receptionist_demo

Sets business hours and time zone, and loads a short FAQ. Every fact in the
FAQ comes from the example scripts in the call manuals; the receptionist may
only state what is written here. Idempotent.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import delete, select

from callsentry.core.db import get_sessionmaker
from callsentry.models import Business, KBChunk, KBDocument
from callsentry.services import kb

FAQ_NAME = "abc-pest-control-faq.md"

FAQ = """# ABC Pest Control - Frequently Asked Questions

## About us
ABC Pest Control is a local, family-owned pest control company and a one-stop shop
for pest control: ants, spiders, cockroaches, scorpions, wasps, termites, rodents
and mosquitos.

## Hours
Office hours are Monday through Friday, 8 AM to 6 PM, and Saturday, 9 AM to 2 PM
(Mountain Time). Closed Sundays.

## The general pest service
The service covers five areas: the base of the home, the yard, the eaves, the back
wall and the interior. The technician power-treats the foundation to protect the
home from pests coming inside, treats the entire yard front and back to stop pests
at the source, and sweeps down cobwebs and wasp nests from the eaves with a soft
bristle brush on an extendable pole. Each visit the technician is there for at
least 30 to 45 minutes.

## Visits
Regular service visits are quarterly, every 3 months. Customers get a reminder
text 2 to 3 days before each visit.

## Pricing
The initial inside and outside service is usually $299. New customers currently
get 50% off the initial service, so it is $199, and then $49 per month after that.
Exact pricing is confirmed by the office.

## Warranty and re-services
Service includes a full warranty: if pests come back between regular visits, we come
back out and re-spray at no extra charge, usually within 2 days.

## Referral program
If someone you refer signs up for a service plan, you get your next month free and
they get their first service free.

## Appointments
Appointments are booked in two-hour arrival windows. The technician knocks when
they arrive.
"""

HOURS = {
    "mon": ["08:00", "18:00"],
    "tue": ["08:00", "18:00"],
    "wed": ["08:00", "18:00"],
    "thu": ["08:00", "18:00"],
    "fri": ["08:00", "18:00"],
    "sat": ["09:00", "14:00"],
    "sun": None,
}


async def main() -> None:
    async with get_sessionmaker()() as session:
        business = await session.scalar(select(Business).limit(1))
        if business is None:
            raise SystemExit("no business - run the seed first")
        business.timezone = "America/Denver"
        business.business_hours = HOURS

        # Replace the FAQ rather than stacking copies.
        old = (
            await session.scalars(
                select(KBDocument.id).where(
                    KBDocument.business_id == business.id, KBDocument.filename == FAQ_NAME
                )
            )
        ).all()
        if old:
            await session.execute(delete(KBChunk).where(KBChunk.document_id.in_(old)))
            await session.execute(delete(KBDocument).where(KBDocument.id.in_(old)))

        await kb.index_document(
            session,
            business_id=business.id,
            filename=FAQ_NAME,
            data=FAQ.encode(),
            content_type="text/markdown",
        )
        await session.commit()
        print(f"Receptionist configured for {business.name}")


if __name__ == "__main__":
    asyncio.run(main())
