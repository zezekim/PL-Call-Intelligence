"""Every text the app sends goes through here.

Normally that's Twilio. In practice mode the text is kept in the in-app
Outbox instead, and the app behaves exactly as if it had been sent: the
action is marked done, the morning menu is remembered, and a reply typed in
the Outbox runs the same code as a real reply would.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.models import Business, OutboxMessage
from callsentry.services.sms import SMSResult, get_sms

PRACTICE = "practice"
# Stands in for the owner's number when practice mode has none to show.
OWNER_PLACEHOLDER = "owner"


async def send(
    session: AsyncSession,
    business: Business,
    *,
    to: str,
    body: str,
    purpose: str,
    name: str | None = None,
    action_id: uuid.UUID | None = None,
) -> SMSResult:
    if not business.practice_mode:
        return await get_sms().send(to=to, body=body)
    session.add(OutboxMessage(business_id=business.id, direction="out", phone=to, name=name,
                              body=body, purpose=purpose, action_id=action_id))
    await session.flush()
    return SMSResult(sent=True, provider=PRACTICE, segments=max(1, (len(body) + 152) // 153))


def record_reply(
    session: AsyncSession, business: Business, *, phone: str, body: str,
    name: str | None = None,
) -> None:
    """A reply typed in the Outbox, shown in the conversation."""
    session.add(OutboxMessage(business_id=business.id, direction="in", phone=phone, name=name,
                              body=body, purpose="reply"))
