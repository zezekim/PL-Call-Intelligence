"""Done for you: every open to-do comes with the action already prepared.

The brief decides *what* needs doing; this module writes the message that
does it and sends it when the owner says yes - or by itself, for the kinds
the owner has put on autopilot.

Three kinds of action, all a text message:

- `text_customer`: a short, friendly text to the customer in the business's
  name (follow up on a quote, confirm a visit, check a problem got fixed,
  try to win back a cancel).
- `remind_rep`: ask the rep who took the call to ring the customer back, with
  the opening line to use. A call closes more than a text, so it comes first
  when the rep has a mobile on file.
- `coach_rep`: the rep's one thing for the week, the words to say, and a link
  to hear the moment from their own call.

Messages are templates over what the analysis found, not model output: they
cost nothing, they're the same every time, and the owner sees the exact words
before anything is sent. Nothing is texted to a number that has opted out,
and autopilot only sends in daytime hours in the business's time zone.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.config import get_settings
from callsentry.intel import brief, insights, phones
from callsentry.models import (
    Business,
    Call,
    CallAnalysis,
    CostCategory,
    FollowUp,
    Lead,
    OwnerAction,
    Rep,
    SmsOptOut,
)
from callsentry.services import costs, spend
from callsentry.services.sms import get_sms

log = structlog.get_logger(__name__)

TEXT_CUSTOMER = "text_customer"
REMIND_REP = "remind_rep"
COACH_REP = "coach_rep"
KINDS = (TEXT_CUSTOMER, REMIND_REP, COACH_REP)

PROPOSED, DONE, FAILED, DISMISSED, EXPIRED = "proposed", "done", "failed", "dismissed", "expired"

# How far back open work is looked for.
WINDOW_DAYS = 30
MAX_BODY = 600
# Autopilot texts people only in the daytime, in the business's own time zone.
SEND_FROM_HOUR, SEND_UNTIL_HOUR = 9, 19
COACH_LINK_DAYS = 21
OPT_OUT_LINE = " Reply STOP to opt out."


class ActionError(ValueError):
    """Why an action can't be done right now, in words for the owner."""


# --- Drafting ------------------------------------------------------------------


def _first(name: str | None) -> str:
    name = (name or "").strip()
    return name.split()[0] if name else ""


def _human_rep(rep: str | None) -> str:
    """The rep's first name, unless it's the AI receptionist."""
    first = _first(rep)
    lowered = (rep or "").lower()
    return "" if "receptionist" in lowered or lowered.split()[:1] == ["ai"] else first


def _from(ctx: dict[str, Any], business: str) -> str:
    person = _human_rep(ctx.get("rep"))
    return f"it's {person} from {business}" if person else f"it's {business}"


def customer_text(ctx: dict[str, Any], business: str) -> str:
    """The text to the customer, in the business's voice."""
    first = _first(ctx.get("customer"))
    hi = f"Hi {first}, " if first else "Hi, "
    about = ctx.get("about") or "your pest problem"
    price = ctx.get("price")
    situation = ctx.get("situation")
    who = _from(ctx, business)
    if situation == "confirm":
        when = f" on {ctx['when']}" if ctx.get("when") else ""
        body = (f"{hi}{who}. Just confirming your visit{when} for {about}. "
                "Does that still work? Reply here if you need a different time.")
    elif situation == "quoted" and price:
        body = (f"{hi}{who}. Following up on the {brief.money(price)} quote for {about}. "
                "Any questions I can answer? Reply here and we can get you booked.")
    elif situation in ("quoted", "follow_up"):
        body = (f"{hi}{who}. You wanted some time to think about {about}. "
                "Happy to answer any questions. Want us to get you on the schedule?")
    elif situation == "winback":
        body = (f"{hi}{who}. I'm sorry we lost you. If there's anything we can do to make "
                "it right, I'd love the chance. Just reply here.")
    elif situation == "checkin":
        body = (f"{hi}{who}. Checking in: did we get {about} sorted out for you? "
                "If not, reply here and we'll make it right.")
    elif situation == "promise":
        body = f"{hi}{who}, following up on your call. What's a good time to reach you?"
    else:
        body = (f"{hi}{who}. Thanks for calling about {about}. "
                "When would be a good time for us to come out?")
    return body + OPT_OUT_LINE


def opening_line(ctx: dict[str, Any], business: str) -> str:
    """What the rep says when the customer picks up."""
    first = _first(ctx.get("customer"))
    hi = f"Hi {first}" if first else "Hi there"
    about = ctx.get("about") or "your pest problem"
    who = _from(ctx, business)
    situation = ctx.get("situation")
    if situation == "confirm":
        return f"{hi}, {who}. I'm calling to confirm your visit for {about}."
    if situation == "quoted" and ctx.get("price"):
        return (f"{hi}, {who}. I'm following up on the {brief.money(ctx['price'])} quote "
                f"for {about}. Any questions I can answer?")
    if situation in ("quoted", "follow_up"):
        return f"{hi}, {who}. You wanted some time to think about {about}. Is now a good time?"
    if situation == "winback":
        return f"{hi}, {who}. I saw you cancelled and wanted to see if we can make it right."
    if situation == "checkin":
        return f"{hi}, {who}. Calling to make sure we got {about} sorted out for you."
    return f"{hi}, {who}. You called us about {about}. When would be good for us to come out?"


def rep_text(ctx: dict[str, Any], business: str, title: str, why: str) -> str:
    customer = ctx.get("customer") or "the customer"
    number = phones.pretty(ctx.get("phone"))
    reach = f" at {number}" if number else ""
    task = ctx.get("promise") or f"call {customer} back today"
    task = task[:1].lower() + task[1:]
    return (f"Hi {_first(ctx.get('rep')) or 'there'}, please {task}{reach}. {why} "
            f"Try opening with: “{opening_line(ctx, business)}” - {business}")


def coach_text(rep: str, tip: dict[str, Any], link: str) -> str:
    say = (tip.get("try_saying") or "").strip()
    return (f"Hi {_first(rep)}, your one thing for this week: {tip.get('title') or 'see the tip'}. "
            + (f"Try saying: “{say}” " if say else "")
            + f"Hear the moment from your own call: {link}")


# --- Coaching links --------------------------------------------------------------


def _sign(payload: str) -> str:
    key = get_settings().jwt_secret.encode()
    return base64.urlsafe_b64encode(hmac.new(key, payload.encode(), hashlib.sha256).digest()[:18]
                                    ).decode().rstrip("=")


def coach_token(action_id: uuid.UUID, now: float | None = None) -> str:
    expires = int((now or time.time()) + COACH_LINK_DAYS * 86400)
    payload = f"{action_id.hex}.{expires:x}"
    return f"{payload}.{_sign(payload)}"


def read_coach_token(token: str, now: float | None = None) -> uuid.UUID | None:
    """The action a coaching link points at, or None if forged or expired."""
    try:
        hex_id, hex_exp, sig = token.split(".")
        expires = int(hex_exp, 16)
        action_id = uuid.UUID(hex=hex_id)
    except ValueError:
        return None
    if not hmac.compare_digest(sig, _sign(f"{hex_id}.{hex_exp}")):
        return None
    if expires < (now or time.time()):
        return None
    return action_id


def coach_link(action_id: uuid.UUID) -> str:
    base = get_settings().public_base_url.removesuffix("/api").rstrip("/")
    return f"{base}/coach/{coach_token(action_id)}"


# --- Proposals -------------------------------------------------------------------


def options_for(
    item: dict[str, Any], business: str, rep_phones: dict[str, tuple[str, str | None]]
) -> list[dict[str, Any]]:
    """The ways to act on one to-do: ask the rep to call, or text the customer.

    Each option carries a `priority` so the better one is offered first: a
    call from the rep on sales work, a text for a check-in.
    """
    ctx = item.get("context") or {}
    customer = ctx.get("customer") or ""
    first = _first(customer) or "the customer"
    out: list[dict[str, Any]] = []
    rep_id = ctx.get("rep_id")
    rep_name, rep_phone = rep_phones.get(rep_id or "", (ctx.get("rep") or "", None))
    common = {
        "item_key": item["key"], "title": item["title"], "why": item.get("why") or "",
        "value_usd": item.get("value"), "href": item.get("href"),
        "lead_id": ctx.get("lead_id"), "call_id": ctx.get("call_id"), "rep_id": rep_id,
    }
    texting_first = ctx.get("situation") in ("checkin", "confirm")
    if _human_rep(rep_name):
        out.append({
            **common, "kind": REMIND_REP,
            "priority": item["priority"] + (0 if texting_first else 2),
            "label": f"Ask {_first(rep_name)} to call",
            "to_phone": rep_phone, "to_name": rep_name,
            "body": rep_text({**ctx, "rep": rep_name}, business, item["title"],
                             item.get("why") or ""),
        })
    out.append({
        **common, "kind": TEXT_CUSTOMER,
        "priority": item["priority"] + (2 if texting_first else 0),
        "label": f"Text {first}",
        "to_phone": ctx.get("phone"), "to_name": customer or None,
        "body": customer_text(ctx, business),
    })
    # An option that can go now beats a better one that needs a number first.
    for o in out:
        if not o["to_phone"]:
            o["priority"] -= 3
    return out


async def _rep_phones(
    session: AsyncSession, business_id: uuid.UUID
) -> dict[str, tuple[str, str | None]]:
    reps = await session.scalars(select(Rep).where(Rep.business_id == business_id))
    return {str(r.id): (r.name, r.phone) for r in reps}


async def _coaching_options(
    session: AsyncSession, business: Business, now: datetime
) -> list[dict[str, Any]]:
    """One coaching text per rep with a mobile, per week."""
    week = brief.iso_week(now)
    out = []
    reps = await session.scalars(
        select(Rep).where(Rep.business_id == business.id, Rep.phone.isnot(None))
    )
    for rep in reps:
        data = await brief.rep_brief(session, business.id, rep.id, days=WINDOW_DAYS)
        tip = (data or {}).get("coach")
        if not tip:
            continue
        out.append({
            "item_key": f"coach:{rep.id}:{week}", "kind": COACH_REP, "priority": 40,
            "title": "This week's coaching",
            "label": f"Send {rep.name} the tip",
            "why": f"{tip.get('title') or 'A step to work on'}, with a moment from their own call.",
            "to_phone": rep.phone, "to_name": rep.name, "rep_id": str(rep.id),
            "call_id": tip.get("call_id"), "href": f"/v2/reps/{rep.id}",
            # The link needs the row's id, so the body is finished on insert.
            "body": "", "tip": tip, "value_usd": None, "lead_id": None,
        })
    return out


async def _open_todo(session: AsyncSession, business_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await insights.load(session, business_id, days=WINDOW_DAYS)
    board = await brief.pipeline(session, business_id)
    follow_ups = (
        await session.execute(
            select(FollowUp, Call, CallAnalysis)
            .join(Call, Call.id == FollowUp.call_id)
            .outerjoin(CallAnalysis, CallAnalysis.call_id == Call.id)
            .where(FollowUp.business_id == business_id, FollowUp.status == "open")
        )
    ).all()
    promised: list[Any] = [tuple(f) for f in follow_ups]
    return brief._todo(rows, board["open"], promised)


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


async def refresh(session: AsyncSession, business: Business) -> int:
    """Bring the prepared actions in line with the open work.

    New situations get drafts; drafts not yet acted on are rewritten with the
    latest details (a number found on a newer call, say); drafts for work
    that is no longer open expire. Returns how many are waiting.
    """
    now = datetime.now(UTC)
    rep_phones = await _rep_phones(session, business.id)
    options: list[dict[str, Any]] = []
    for item in await _open_todo(session, business.id):
        if item.get("key"):
            options.extend(options_for(item, business.name, rep_phones))
    options.extend(await _coaching_options(session, business, now))
    # Nobody who texted STOP is offered as someone to text.
    blocked = set(await session.scalars(
        select(SmsOptOut.phone).where(SmsOptOut.business_id == business.id)))
    options = [o for o in options if not (o["to_phone"] and o["to_phone"] in blocked)]

    keys = set()
    for o in options:
        keys.add(o["item_key"])
        values = {
            "business_id": business.id, "item_key": o["item_key"], "kind": o["kind"],
            "priority": o["priority"], "title": o["title"], "label": o["label"],
            "why": o["why"], "to_phone": o["to_phone"], "to_name": o["to_name"],
            "body": o["body"], "value_usd": o["value_usd"], "href": o["href"],
            "lead_id": _uuid(o.get("lead_id")), "call_id": _uuid(o.get("call_id")),
            "rep_id": _uuid(o.get("rep_id")),
        }
        changing = {k: v for k, v in values.items()
                    if k not in ("business_id", "item_key", "kind")}
        stmt = insert(OwnerAction).values(id=uuid.uuid4(), **values)
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=["business_id", "item_key", "kind"],
                set_={**changing, "updated_at": now},
                # Once acted on, an action is a record of what was sent.
                where=OwnerAction.status.in_((PROPOSED, FAILED)),
            )
        )
        if o["kind"] == COACH_REP:
            row = await session.scalar(select(OwnerAction).where(
                OwnerAction.business_id == business.id, OwnerAction.item_key == o["item_key"],
                OwnerAction.kind == COACH_REP))
            if row is not None and row.status in (PROPOSED, FAILED):
                row.body = coach_text(o["to_name"], o["tip"], coach_link(row.id))

    gone = update(OwnerAction).where(
        OwnerAction.business_id == business.id, OwnerAction.status.in_((PROPOSED, FAILED)),
    )
    if keys:
        gone = gone.where(OwnerAction.item_key.notin_(keys))
    await session.execute(gone.values(status=EXPIRED, updated_at=now))
    await session.flush()
    return len(options)


async def waiting(session: AsyncSession, business_id: uuid.UUID) -> list[OwnerAction]:
    """Prepared actions, best first, one per situation."""
    rows = list(await session.scalars(
        select(OwnerAction).where(OwnerAction.business_id == business_id,
                                  OwnerAction.status.in_((PROPOSED, FAILED)))
        .order_by(OwnerAction.priority.desc(), OwnerAction.created_at)
    ))
    seen: set[str] = set()
    out = []
    for a in rows:
        if a.item_key not in seen:
            seen.add(a.item_key)
            out.append(a)
    return out


# --- Doing it --------------------------------------------------------------------


async def opted_out(session: AsyncSession, business_id: uuid.UUID, phone: str) -> bool:
    return bool(await session.scalar(
        select(SmsOptOut.id).where(SmsOptOut.business_id == business_id, SmsOptOut.phone == phone)
    ))


async def perform(
    session: AsyncSession,
    action: OwnerAction,
    *,
    by: str,
    body: str | None = None,
    phone: str | None = None,
    auto: bool = False,
) -> OwnerAction:
    """Send it. A send that fails is kept as `failed` with the reason, and can
    be tried again; anything that stops it before sending raises ActionError."""
    if action.status not in (PROPOSED, FAILED):
        raise ActionError("This has already been done.")
    if body is not None:
        body = " ".join(body.split())
        if not body:
            raise ActionError("The message is empty.")
        action.body = body[:MAX_BODY]
    if phone is not None:
        number = phones.normalize(phone)
        if number is None:
            raise ActionError("That doesn't look like a phone number.")
        action.to_phone = number
        await _remember_number(session, action, number)
    if not action.to_phone:
        # Added since this was drafted (on the rep's page, say).
        action.to_phone = await _known_number(session, action)
    if not action.to_phone:
        who = action.to_name or ("the rep" if action.kind != TEXT_CUSTOMER else "the customer")
        raise ActionError(f"We don't have a mobile number for {who} yet.")
    if await opted_out(session, action.business_id, action.to_phone):
        raise ActionError(f"{action.to_name or 'This number'} asked not to get texts.")
    if spend.exceeded():
        raise ActionError("Today's spending cap has been reached.")

    result = await get_sms().send(to=action.to_phone, body=action.body)
    now = datetime.now(UTC)
    action.updated_at = now
    if not result.sent:
        action.status = FAILED
        action.error = ("Texting isn't set up yet. Add Twilio in Settings."
                        if result.error == "twilio not configured"
                        else "The text didn't go through. Try again in a minute.")
        log.warning("action.failed", action=str(action.id), error=result.error)
        await session.flush()
        return action

    await costs.record(
        session, business_id=action.business_id, call_id=action.call_id,
        category=CostCategory.TELEPHONY, provider=result.provider, tier="cloud",
        units=result.segments, unit_name="sms_segment", cost_usd=result.cost_usd,
    )
    action.status, action.error = DONE, None
    action.done_at, action.done_by, action.auto = now, by, auto
    action.message_sid = result.message_sid
    # One way of acting on a situation is enough.
    await session.execute(
        update(OwnerAction)
        .where(OwnerAction.business_id == action.business_id,
               OwnerAction.item_key == action.item_key, OwnerAction.id != action.id,
               OwnerAction.status.in_((PROPOSED, FAILED)))
        .values(status=DISMISSED, updated_at=now)
    )
    await session.flush()
    log.info("action.done", action=str(action.id), kind=action.kind, auto=auto)
    return action


async def _known_number(session: AsyncSession, action: OwnerAction) -> str | None:
    if action.kind == TEXT_CUSTOMER and action.lead_id:
        lead = await session.get(Lead, action.lead_id)
        return lead.phone if lead else None
    if action.kind in (REMIND_REP, COACH_REP) and action.rep_id:
        rep = await session.get(Rep, action.rep_id)
        return rep.phone if rep else None
    return None


async def _remember_number(session: AsyncSession, action: OwnerAction, number: str) -> None:
    """A number the owner typed in is kept, so it's there next time."""
    if action.kind == TEXT_CUSTOMER and action.lead_id:
        lead = await session.get(Lead, action.lead_id)
        if lead is not None:
            lead.phone = number
    elif action.kind in (REMIND_REP, COACH_REP) and action.rep_id:
        rep = await session.get(Rep, action.rep_id)
        if rep is not None:
            rep.phone = number


async def dismiss(session: AsyncSession, action: OwnerAction) -> None:
    """Set a whole situation aside: none of its options are offered again."""
    await session.execute(
        update(OwnerAction)
        .where(OwnerAction.business_id == action.business_id,
               OwnerAction.item_key == action.item_key,
               OwnerAction.status.in_((PROPOSED, FAILED)))
        .values(status=DISMISSED, updated_at=datetime.now(UTC))
    )


# --- Autopilot -------------------------------------------------------------------


def local_now(business: Business, now: datetime | None = None) -> datetime:
    try:
        zone = ZoneInfo(business.timezone or "UTC")
    except (KeyError, ValueError):
        zone = ZoneInfo("UTC")
    return (now or datetime.now(UTC)).astimezone(zone)


def daytime(business: Business, now: datetime | None = None) -> bool:
    """Monday to Saturday, 9am to 7pm in the business's time zone."""
    local = local_now(business, now)
    return local.weekday() < 6 and SEND_FROM_HOUR <= local.hour < SEND_UNTIL_HOUR


def enabled_kinds(business: Business) -> set[str]:
    return {k for k, on in (business.autopilot or {}).items() if on and k in KINDS}


async def run_autopilot(session: AsyncSession, business: Business) -> int:
    """Do the waiting actions the owner has said to always do."""
    kinds = enabled_kinds(business)
    if not kinds or not daytime(business):
        return 0
    done = 0
    for action in await waiting(session, business.id):
        # The best option for a situation, if it's a kind on autopilot; never
        # a failed one again without a person looking at it.
        if action.kind not in kinds or action.status != PROPOSED or not action.to_phone:
            continue
        try:
            await perform(session, action, by="Autopilot", auto=True)
        except ActionError as exc:
            log.info("autopilot.skipped", action=str(action.id), reason=str(exc))
            continue
        if action.status == DONE:
            done += 1
    return done


async def approvals(session: AsyncSession, business_id: uuid.UUID) -> dict[str, int]:
    """How many of each kind a person has sent, so the app can offer autopilot
    once it's clearly something they always say yes to."""
    since = datetime.now(UTC) - timedelta(days=60)
    rows = await session.scalars(
        select(OwnerAction.kind).where(
            OwnerAction.business_id == business_id, OwnerAction.status == DONE,
            OwnerAction.auto.is_(False), OwnerAction.done_at >= since,
        )
    )
    counts: dict[str, int] = {}
    for kind in rows:
        counts[kind] = counts.get(kind, 0) + 1
    return counts
