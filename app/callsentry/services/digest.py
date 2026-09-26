"""The weekly email digest: last week's calls, what needs doing, what to coach.

Sent Monday morning in the business's own time zone, once per week, over the
SMTP server configured in Settings. Nothing is sent until SMTP is set up and
the digest is switched on.
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
import uuid
from datetime import datetime
from email.message import EmailMessage
from html import escape
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.config import get_settings
from callsentry.intel import insights
from callsentry.models import Business
from callsentry.services.callstate import _redis

log = structlog.get_logger(__name__)

SEND_WEEKDAY = 0  # Monday
SEND_HOUR = 8


class DigestError(RuntimeError):
    pass


def recipients() -> list[str]:
    return [r.strip() for r in get_settings().digest_recipients.split(",") if r.strip()]


def configured() -> str | None:
    """None when a digest can be sent, otherwise what is missing."""
    s = get_settings()
    if not s.smtp_host:
        return "SMTP server is not set"
    if not recipients():
        return "no recipients"
    if not (s.smtp_from or s.smtp_username):
        return "no from address"
    return None


def _pct(value: float | None) -> str:
    return "-" if value is None else f"{round(value)}%"


def compose(business: Business, data: dict[str, Any]) -> tuple[str, str, str]:
    """Subject, plain text and HTML for one week's overview."""
    card = data["scorecard"]
    sales = data["sales"]
    retention = data["retention"]
    base = get_settings().public_base_url.removesuffix("/api").rstrip("/")
    subject = (
        f"{business.name}: {card['calls']} calls this week, "
        f"average score {_pct(card['avg_score_pct'])}"
    )
    saved, cancelled = retention["saved"], retention["cancelled"]
    meeting = card["grades"]["gold"] + card["grades"]["green"]

    stats = [
        ("Calls analyzed", str(card["calls"])),
        ("Average score", _pct(card["avg_score_pct"])),
        ("Sales closed", _pct(sales["close_rate"])),
        ("Cancels saved", f"{saved} of {saved + cancelled}"),
        ("Gold or Green", f"{meeting} of {card['scored']}"),
    ]
    todo = [
        (f"{len(data['follow_ups'])} open follow-ups", "/calls#follow-ups"),
        (f"{card.get('disputed_calls', 0)} calls with disputed steps", "/calls/log?disputed=1"),
        (f"{card['needs_review']} call types to confirm", "/calls/log?review=1"),
    ]
    todo = [t for t in todo if not t[0].startswith("0 ")]
    coach = [
        f"{t['step']}: missed on {t['missed']} of {t['of']} calls" for t in data["training"][:4]
    ]

    lines = [subject, ""]
    lines += [f"{label}: {value}" for label, value in stats]
    if todo:
        lines += ["", "Needs attention"] + [f"- {label}: {base}{href}" for label, href in todo]
    if coach:
        lines += ["", "Coach on"] + [f"- {c}" for c in coach]
    lines += ["", f"Open the dashboard: {base}/calls"]
    text = "\n".join(lines)

    font = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif"
    cells = "".join(
        f'<td style="padding:12px 16px 12px 0"><div style="font-size:12px;color:#6e6e73">'
        f'{escape(label)}</div><div style="font-size:22px;font-weight:600;color:#1d1d1f">'
        f"{escape(value)}</div></td>"
        for label, value in stats
    )
    todo_html = "".join(
        f'<li style="margin:4px 0"><a href="{escape(base + href)}" style="color:#0066cc">'
        f"{escape(label)}</a></li>"
        for label, href in todo
    )
    coach_html = "".join(f'<li style="margin:4px 0">{escape(c)}</li>' for c in coach)
    section = (
        '<h2 style="font-size:15px;margin:24px 0 6px;color:#1d1d1f">{}</h2>'
        '<ul style="margin:0;padding-left:18px;color:#1d1d1f">{}</ul>'
    )
    html = (
        f'<div style="font-family:{font};max-width:560px;color:#1d1d1f">'
        f'<p style="font-size:13px;color:#6e6e73;margin:0">Weekly digest</p>'
        f'<h1 style="font-size:22px;margin:4px 0 12px">{escape(business.name)}</h1>'
        f"<table><tr>{cells}</tr></table>"
        + (section.format("Needs attention", todo_html) if todo else "")
        + (section.format("Coach on", coach_html) if coach else "")
        + f'<p style="margin-top:24px"><a href="{escape(base)}/calls" '
        'style="display:inline-block;background:#0071e3;color:#fff;padding:8px 16px;'
        'border-radius:999px;text-decoration:none;font-size:14px">Open the dashboard</a></p>'
        "</div>"
    )
    return subject, text, html


def _send_sync(message: EmailMessage) -> None:
    s = get_settings()
    context = ssl.create_default_context()
    if s.smtp_port == 465:
        server: smtplib.SMTP = smtplib.SMTP_SSL(
            s.smtp_host, s.smtp_port, timeout=20, context=context
        )
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20)
        server.ehlo()
        # Every real provider offers STARTTLS; a local relay may not.
        if server.has_extn("starttls"):
            server.starttls(context=context)
            server.ehlo()
    with server:
        if s.smtp_username:
            server.login(s.smtp_username, s.smtp_password)
        server.send_message(message)


async def send(session: AsyncSession, business: Business, to: list[str] | None = None) -> None:
    missing = configured()
    if missing and not (to and get_settings().smtp_host):
        raise DigestError(f"Email is not set up: {missing}")
    data = await insights.overview(session, business.id, days=7)
    subject, text, html = compose(business, data)
    s = get_settings()
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = s.smtp_from or s.smtp_username
    message["To"] = ", ".join(to or recipients())
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    try:
        await asyncio.to_thread(_send_sync, message)
    except (smtplib.SMTPException, OSError) as exc:
        raise DigestError(f"Could not send: {exc}") from exc
    log.info("digest.sent", business=str(business.id), recipients=len(to or recipients()))


def _week_key(business_id: uuid.UUID, now: datetime) -> str:
    year, week, _ = now.isocalendar()
    return f"digest:sent:{business_id}:{year}-{week:02d}"


async def maybe_send(session: AsyncSession) -> int:
    """Called by the background loop; sends each business's digest once a week."""
    if not get_settings().weekly_digest or configured():
        return 0
    sent = 0
    for business in (await session.scalars(select(Business))).all():
        try:
            now = datetime.now(ZoneInfo(business.timezone or "UTC"))
        except (KeyError, ValueError):
            now = datetime.now(ZoneInfo("UTC"))
        if now.weekday() != SEND_WEEKDAY or now.hour < SEND_HOUR:
            continue
        key = _week_key(business.id, now)
        # SET NX first so two app replicas never both send.
        if not await _redis().set(key, "1", nx=True, ex=8 * 24 * 3600):
            continue
        try:
            await send(session, business)
            sent += 1
        except DigestError as exc:
            await _redis().delete(key)
            log.warning("digest.failed", business=str(business.id), error=str(exc))
    return sent
