"""Done for you: the prepared actions on Today, and the reps' coaching cards.

`/intel/actions/*` is for signed-in managers. `/public/coach/{token}` is the
page a rep opens from their weekly coaching text: no account, authorised by
a signed, expiring link to that one card.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from callsentry.api.deps import BusinessDep, SessionDep, UserDep
from callsentry.api.routes.intel import _audio_url
from callsentry.intel import actions, brief, morning, outbox, phones
from callsentry.models import Business, Call, OutboxMessage, OwnerAction, Rep
from callsentry.services import ratelimit

router = APIRouter(tags=["actions"])


class PerformRequest(BaseModel):
    # The message as the owner left it, and a number they typed in.
    body: str | None = Field(default=None, max_length=actions.MAX_BODY)
    phone: str | None = Field(default=None, max_length=32)


class AutopilotUpdate(BaseModel):
    kind: str
    on: bool


async def _owned(session: SessionDep, business_id: uuid.UUID, action_id: uuid.UUID) -> OwnerAction:
    action = await session.get(OwnerAction, action_id)
    if action is None or action.business_id != business_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "action not found")
    return action


@router.post("/intel/actions/refresh")
async def refresh_actions(session: SessionDep, business: BusinessDep) -> dict[str, int]:
    """Draft the actions for any new open work. Today calls this on load."""
    count = await actions.refresh(session, business)
    await session.commit()
    return {"prepared": count}


@router.get("/intel/actions/summary")
async def actions_summary(session: SessionDep, business: BusinessDep) -> dict[str, Any]:
    """What autopilot is doing, and how often each kind has been sent by hand."""
    since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    done_today = list(await session.scalars(
        select(OwnerAction).where(OwnerAction.business_id == business.id,
                                  OwnerAction.status == actions.DONE,
                                  OwnerAction.done_at >= since)
        .order_by(OwnerAction.done_at.desc())
    ))
    replies = list(await session.scalars(
        select(OwnerAction).where(OwnerAction.business_id == business.id,
                                  OwnerAction.replied_at.isnot(None))
        .order_by(OwnerAction.replied_at.desc()).limit(5)
    ))
    coaching = [a for a in await actions.waiting(session, business.id)
                if a.kind == actions.COACH_REP]
    return {
        "autopilot": {k: k in actions.enabled_kinds(business) for k in actions.KINDS},
        "coaching_waiting": [brief.action_out(a) for a in coaching],
        "approvals": await actions.approvals(session, business.id),
        "done_today": [brief.action_out(a) for a in done_today],
        "replies": [{**brief.action_out(a), "title": a.title, "href": a.href} for a in replies],
        "daytime": actions.daytime(business),
        "practice": business.practice_mode,
    }


@router.post("/intel/actions/{action_id}/perform")
async def perform_action(
    action_id: uuid.UUID, payload: PerformRequest, session: SessionDep,
    business: BusinessDep, user: UserDep,
) -> dict[str, Any]:
    action = await _owned(session, business.id, action_id)
    try:
        await actions.perform(session, action, by=user.email, body=payload.body,
                              phone=payload.phone)
    except actions.ActionError as exc:
        await session.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await session.commit()
    return brief.action_out(action)


@router.post("/intel/actions/{action_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_action(action_id: uuid.UUID, session: SessionDep, business: BusinessDep) -> None:
    await actions.dismiss(session, await _owned(session, business.id, action_id))
    await session.commit()


@router.put("/intel/actions/autopilot")
async def set_autopilot(
    payload: AutopilotUpdate, session: SessionDep, business: BusinessDep
) -> dict[str, bool]:
    if payload.kind not in actions.KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown kind")
    business.autopilot = {**(business.autopilot or {}), payload.kind: payload.on}
    await session.commit()
    return {k: k in actions.enabled_kinds(business) for k in actions.KINDS}


@router.post("/intel/morning/test", status_code=status.HTTP_204_NO_CONTENT)
async def send_morning_now(session: SessionDep, business: BusinessDep) -> None:
    """Send the morning text now, to see what it looks like."""
    if morning.owner_number(business) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add your mobile number first.")
    if not await morning.send_now(session, business, greeting=False):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "The text didn't go through. Check Twilio in Settings.")


class RepPhone(BaseModel):
    phone: str = Field(max_length=32)


@router.put("/intel/reps/{rep_id}/phone")
async def set_rep_phone(
    rep_id: uuid.UUID, payload: RepPhone, session: SessionDep, business: BusinessDep
) -> dict[str, str | None]:
    rep = await session.get(Rep, rep_id)
    if rep is None or rep.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rep not found")
    if payload.phone.strip():
        number = phones.normalize(payload.phone)
        if number is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Enter a mobile number like (555) 123-4567")
        rep.phone = number
    else:
        rep.phone = None
    await session.commit()
    return {"phone": rep.phone, "pretty": phones.pretty(rep.phone)}


# --- Practice mode: the Outbox ------------------------------------------------------


class OutboxReply(BaseModel):
    # Who is replying: "owner", or the number a text went to.
    phone: str = Field(max_length=32)
    text: str = Field(min_length=1, max_length=1600)


def _message_out(m: OutboxMessage) -> dict[str, Any]:
    owner = m.phone == outbox.OWNER_PLACEHOLDER or m.purpose in ("morning", "forward", "answer")
    return {
        "id": str(m.id), "direction": m.direction, "purpose": m.purpose, "body": m.body,
        "phone": m.phone, "phone_pretty": phones.pretty(m.phone) if not owner else "",
        "name": "You" if owner else m.name, "to_owner": owner,
        "created_at": m.created_at.isoformat(),
    }


@router.get("/intel/outbox")
async def list_outbox(session: SessionDep, business: BusinessDep) -> dict[str, Any]:
    rows = list(await session.scalars(
        select(OutboxMessage).where(OutboxMessage.business_id == business.id)
        .order_by(OutboxMessage.created_at.desc()).limit(100)
    ))
    return {"practice": business.practice_mode, "messages": [_message_out(m) for m in rows]}


@router.post("/intel/outbox/reply")
async def reply_in_outbox(
    payload: OutboxReply, session: SessionDep, business: BusinessDep
) -> dict[str, Any]:
    """Answer a practice text as the person it went to. The owner's answer goes
    through the morning-text handler, a customer's through the reply handler,
    exactly as a real text back would."""
    if not business.practice_mode:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Practice mode is off.")
    text = payload.text.strip()
    owner = payload.phone in (outbox.OWNER_PLACEHOLDER, business.owner_phone)
    if owner:
        outbox.record_reply(session, business, phone=payload.phone, body=text, name="You")
        await session.flush()
        answer = await morning.handle_owner(session, business, text)
        await outbox.send(session, business, to=payload.phone, body=answer, purpose="answer",
                          name="You")
    else:
        number = phones.normalize(payload.phone)
        if number is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown number")
        last = await session.scalar(
            select(OutboxMessage.name).where(OutboxMessage.business_id == business.id,
                                             OutboxMessage.phone == number)
            .order_by(OutboxMessage.created_at.desc()).limit(1))
        outbox.record_reply(session, business, phone=number, body=text, name=last)
        await session.flush()
        await morning.handle_customer(session, business, number, text)
    await session.commit()
    return await list_outbox(session, business)


@router.delete("/intel/outbox", status_code=status.HTTP_204_NO_CONTENT)
async def clear_outbox(session: SessionDep, business: BusinessDep) -> None:
    from sqlalchemy import delete

    await session.execute(delete(OutboxMessage).where(OutboxMessage.business_id == business.id))
    await session.commit()


# --- The rep's coaching card (no sign-in) ----------------------------------------


async def _card_action(session: SessionDep, token: str, request: Request) -> OwnerAction:
    if not await ratelimit.allow(f"coach:{ratelimit.client_ip(request)}", 60, 60):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "slow down")
    action_id = actions.read_coach_token(token)
    action = await session.get(OwnerAction, action_id) if action_id else None
    # One answer for forged, expired and deleted, so links can't be probed.
    if action is None or action.kind != actions.COACH_REP or action.status != actions.DONE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link has expired.")
    return action


@router.get("/public/coach/{token}")
async def coaching_card(token: str, request: Request, session: SessionDep) -> dict[str, Any]:
    action = await _card_action(session, token, request)
    business = await session.get(Business, action.business_id)
    rep = await session.get(Rep, action.rep_id) if action.rep_id else None
    data = (await brief.rep_brief(session, action.business_id, rep.id, days=actions.WINDOW_DAYS)
            if rep else None) or {}
    tip = data.get("coach") or {}
    call = await session.get(Call, action.call_id) if action.call_id else None
    if action.opened_at is None:
        action.opened_at = datetime.now(UTC)
        await session.commit()
    return {
        "business": business.name if business else "",
        "rep": rep.name if rep else action.to_name,
        "title": tip.get("title") or action.why,
        "what_happened": tip.get("what_happened"),
        "try_saying": tip.get("try_saying"),
        "start": tip.get("start"),
        "audio_url": _audio_url(call) if call else None,
        "strength": (data.get("strength_example") or {}).get("title"),
    }


@router.post("/public/coach/{token}/listened", status_code=status.HTTP_204_NO_CONTENT)
async def coaching_listened(token: str, request: Request, session: SessionDep) -> None:
    action = await _card_action(session, token, request)
    if action.listened_at is None:
        action.listened_at = datetime.now(UTC)
        await session.commit()
