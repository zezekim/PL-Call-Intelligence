"""The morning text: what needs the owner today, and a reply to get it done.

Owners who never open a dashboard still read their texts. At 8am in the
business's time zone the owner gets the money at stake and the top three
prepared actions, numbered. Replying "1" (or "1 3", or "ALL") does them;
"LIST" sends a fresh list at any time.

Customers' replies to texts the app sent come in on the same number, and are
passed on to the owner so a conversation is never lost.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.intel import actions, brief, outbox, phones
from callsentry.models import Business, OwnerAction, SmsOptOut
from callsentry.services.callstate import _redis

log = structlog.get_logger(__name__)

SEND_HOUR = 8
MENU_SIZE = 3
MENU_TTL_SECONDS = 20 * 3600
STOP_WORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit"}
START_WORDS = {"start", "unstop", "yes"}


def _menu_key(business_id: uuid.UUID) -> str:
    return f"morning:menu:{business_id}"


def compose(money_line: str | None, items: list[OwnerAction], *, greeting: bool) -> str:
    """The text itself: short enough to read at a glance on a lock screen."""
    lines = ["Good morning!" if greeting else "Here's what's waiting:"]
    if money_line:
        lines.append(money_line)
    if not items:
        lines.append("Nothing needs you today.")
        return "\n".join(lines)
    lines.append("")
    for n, a in enumerate(items, start=1):
        value = f" ({brief.money(float(a.value_usd))} a year)" if a.value_usd else ""
        lines.append(f"{n}) {a.label}: {_short(a.title)}{value}")
    choices = ", ".join(str(n) for n in range(1, len(items))) + f" or {len(items)}" \
        if len(items) > 1 else "1"
    lines += ["", f"Reply {choices} and I'll do it. Reply ALL for all of them."]
    return "\n".join(lines)


def _short(text: str, limit: int = 60) -> str:
    text = text.rstrip(".")
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


async def _money_line(session: AsyncSession, business_id: uuid.UUID) -> str | None:
    board = await brief.pipeline(session, business_id)
    handled = await brief.recently_handled_leads(session, business_id)
    return brief.money_line(brief.without_handled(board["summary"], board["open"], handled))


async def build_menu(
    session: AsyncSession, business: Business, *, greeting: bool
) -> tuple[str, list[OwnerAction]]:
    await actions.refresh(session, business)
    items = (await actions.waiting(session, business.id))[:MENU_SIZE]
    body = compose(await _money_line(session, business.id), items, greeting=greeting)
    await _redis().set(_menu_key(business.id), json.dumps([str(a.id) for a in items]),
                       ex=MENU_TTL_SECONDS)
    return body, items


def owner_number(business: Business) -> str | None:
    """Where the owner's texts go: their mobile, or the Outbox in practice."""
    if business.owner_phone:
        return business.owner_phone
    return outbox.OWNER_PLACEHOLDER if business.practice_mode else None


async def send_now(session: AsyncSession, business: Business, *, greeting: bool = True) -> bool:
    to = owner_number(business)
    if to is None:
        return False
    body, _items = await build_menu(session, business, greeting=greeting)
    result = await outbox.send(session, business, to=to, body=body, purpose="morning", name="You")
    await session.commit()
    return result.sent


async def maybe_send(session: AsyncSession) -> int:
    """Called by the background loop: each business's text, once a day."""
    sent = 0
    for business in (await session.scalars(
        select(Business).where(Business.morning_text.is_(True),
                               or_(Business.owner_phone.isnot(None),
                                   Business.practice_mode.is_(True)))
    )).all():
        local = actions.local_now(business)
        if local.hour < SEND_HOUR:
            continue
        key = f"morning:sent:{business.id}:{local.date().isoformat()}"
        # SET NX first so two app replicas never both send.
        if not await _redis().set(key, "1", nx=True, ex=36 * 3600):
            continue
        try:
            if await send_now(session, business):
                sent += 1
        except Exception as exc:  # noqa: BLE001 - one business must not stop the rest
            await _redis().delete(key)
            log.warning("morning.failed", business=str(business.id), error=str(exc))
    return sent


# --- Replies -----------------------------------------------------------------------


def parse_choice(text: str, size: int) -> list[int] | str:
    """Which menu items a reply picks: [1, 3], or "all", "list" or "help"."""
    words = text.strip().lower()
    if words in ("all", "all of them", "do all", "yes all"):
        return list(range(1, size + 1))
    if words in ("list", "menu", "?", "more", "what", "today"):
        return "list"
    numbers = [int(n) for n in re.findall(r"\d+", words)]
    if numbers and all(1 <= n <= size for n in numbers):
        return sorted(set(numbers))
    return "help"


async def handle_owner(session: AsyncSession, business: Business, text: str) -> str:
    """Do what the owner picked; the answer is texted straight back."""
    raw = await _redis().get(_menu_key(business.id))
    ids = json.loads(raw) if raw else []
    choice = parse_choice(text, len(ids))
    if choice == "list" or not ids:
        body, _ = await build_menu(session, business, greeting=False)
        await session.commit()
        return body
    if isinstance(choice, str):
        return f"Reply a number from 1 to {len(ids)}, ALL, or LIST for what's waiting."
    done, problems = [], []
    for n in choice:
        action = await session.get(OwnerAction, uuid.UUID(ids[n - 1]))
        if action is None or action.business_id != business.id:
            continue
        if action.status == actions.DONE:
            done.append(f"{n}) already done")
            continue
        try:
            await actions.perform(session, action, by="Owner (by text)")
        except actions.ActionError as exc:
            problems.append(f"{n}) {exc}")
            continue
        if action.status == actions.DONE:
            done.append(f"{n}) {action.label}: sent")
        else:
            problems.append(f"{n}) {action.error}")
    await session.commit()
    lines = (["Done:"] + done if done else []) + (["Couldn't do:"] + problems if problems else [])
    if problems:
        lines.append("Open the app to fix these.")
    return "\n".join(lines)


async def handle_customer(
    session: AsyncSession, business: Business, phone: str, text: str
) -> None:
    """STOP / START, or a reply to one of our texts: passed on to the owner."""
    word = text.strip().lower()
    if word in STOP_WORDS:
        await session.execute(
            insert(SmsOptOut).values(id=uuid.uuid4(), business_id=business.id, phone=phone)
            .on_conflict_do_nothing(index_elements=["business_id", "phone"])
        )
        await session.commit()
        return
    if word in START_WORDS:
        out = await session.scalar(select(SmsOptOut).where(
            SmsOptOut.business_id == business.id, SmsOptOut.phone == phone))
        if out is not None:
            await session.delete(out)
            await session.commit()
        if word != "yes":
            return
    since = datetime.now(UTC) - timedelta(days=14)
    sent = await session.scalar(
        select(OwnerAction)
        .where(OwnerAction.business_id == business.id, OwnerAction.to_phone == phone,
               OwnerAction.status == actions.DONE, OwnerAction.done_at >= since)
        .order_by(OwnerAction.done_at.desc())
        .limit(1)
    )
    if sent is None:
        return
    sent.reply_text = text.strip()[:1000]
    sent.replied_at = datetime.now(UTC)
    await session.commit()
    to = owner_number(business)
    if to:
        who = sent.to_name or phones.pretty(phone)
        await outbox.send(
            session, business, to=to, purpose="forward", name="You",
            body=f"{who} replied: “{_short(text.strip(), 300)}”\n"
                 f"Text them back at {phones.pretty(phone)}.",
        )
        await session.commit()
