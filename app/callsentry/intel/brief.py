"""The owner's brief: what is happening, is it good or bad, what to do next.

The v1 insights return everything the analysis knows. This module decides
what matters: each metric is judged against a target, open work is turned into
a short ranked list of actions, and coaching is reduced to one focus with the
words to use and the call to listen to.

Every judgement here is deterministic code over stored analyses; nothing calls
a model.
"""

from __future__ import annotations

import re
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.intel import insights
from callsentry.intel.insights import Row
from callsentry.intel.rubrics import LENS_BY_CALL_TYPE, SCORECARDS
from callsentry.models import (
    Call,
    CallAnalysis,
    FollowUp,
    Lead,
    LeadStage,
    ProcessingStatus,
    Rep,
)

# --- Targets -------------------------------------------------------------------
#
# What "good" means for each headline number. Industry-typical defaults for a
# residential pest control office; a company would tune them to its own goals.


@dataclass(frozen=True)
class Target:
    good: float  # at or above: on target
    watch: float  # at or above: below target but not alarming; under it: problem

    def status(self, value: float | None) -> str:
        if value is None:
            return "none"
        if value >= self.good:
            return "good"
        return "watch" if value >= self.watch else "bad"


TARGETS = {
    "close_rate": Target(good=50, watch=35),
    "save_rate": Target(good=60, watch=40),
    "resolution_rate": Target(good=85, watch=70),
    # Share of scorecard steps done; Green on every scorecard is about 85-90%.
    "call_quality": Target(good=85, watch=65),
}

# Everyday names for the scorecard steps, so anyone can read them. The manual's
# own names ("Expectation Statement") mean little outside a training session.
PLAIN_STEPS: dict[str, tuple[str, str]] = {
    "validate": ("Show you care", "Say you're sorry about their exact problem."),
    "confidence_statement": ("Promise to help", "Tell them you will take care of it."),
    "expectation_statement_1": ("Say what you'll ask", "Tell them you'll ask a few questions."),
    "investigate": ("Ask questions", "Ask what, where and when to understand the problem."),
    "summary_statement": ("Repeat it back", "Say their problem back in your own words."),
    "expectation_statement_2": ("Explain the plan",
                                "Say you'll go over the service first, then the price."),
    "present_solution": ("Offer the fix", "Explain what you'll do and why it helps them."),
    "consensus": ("Check they agree", "Ask if it makes sense or if they have questions."),
    "close": ("Ask to book", "Ask them to set a time, like morning or afternoon."),
    "provide_conclusion": ("Confirm the details", "Repeat the date, time and address."),
    "thank_customer": ("Say thank you", "Thank them for calling."),
    "final_information": ("Leave the door open",
                          "Tell them to call you first for any other pest problem."),
    "validate_confidence": ("Stay calm and reassure",
                            "Promise to help, without agreeing to cancel yet."),
    "transition_statement": ("Look up the account", "Ask for the address and check the account."),
    "do_research": ("Check their history",
                    "Mention how long they've been a customer or recent visits."),
    "validate_summary": ("Repeat the reason", "Say back why they want to cancel."),
    "validate_expectation": ("Offer options", "Say you want to make it right and have options."),
    "repeat": ("Try again", "If they say no, ask more and offer something else."),
    "leave_teaser": ("End on a good note", "Invite them back, like a free first visit."),
    "pricing": ("Give the price clearly",
                "Say the full price, then the deal, then the monthly price."),
    "objection_agree": ("Agree first", "When they push back, agree before you answer."),
    "objection_restate": ("Find the real worry", "Repeat their concern and ask what's behind it."),
    "objection_resolve": ("Answer the worry", "Solve the concern and show the value."),
    "objection_reclose": ("Ask again", "Ask for the sale again."),
}


def plain_step(key: str, fallback: str = "") -> tuple[str, str]:
    return PLAIN_STEPS.get(key, (fallback or key, ""))



# A rate is only called good or bad once it rests on this many calls: "0 of 1
# kept" is one conversation, not a trend.
MIN_JUDGE = 3


def _judge(target: str, rate: float | None, decided: int) -> str:
    return TARGETS[target].status(rate) if decided >= MIN_JUDGE else "none"


def _few(decided: int) -> str:
    return f" · only {_plural(decided, 'call')} so far" if 0 < decided < MIN_JUDGE else ""


# What each area's status means, in words (no numbers: the card shows those).
VERDICTS = {
    "sales": {"bad": "New customers are not saying yes often enough",
              "watch": "A few too many new customers are not saying yes"},
    "retention": {"bad": "Customers who call to cancel are not being kept",
                  "watch": "A few too many customers who call to cancel are leaving"},
    "service": {"bad": "Customer problems are often not fixed on the call",
                "watch": "A few customer problems are not fixed on the call"},
}


# A step counts as a strength or a gap only with enough calls to judge it.
MIN_ATTEMPTS = 2

CANCEL_REASON_LABEL = {
    "price": "price",
    "moving": "moving",
    "service_quality": "service quality",
    "pests_persist": "pests coming back",
    "no_longer_needed": "no longer needed",
    "switching_provider": "switching provider",
    "financial_hardship": "financial hardship",
    "technician_issue": "a technician issue",
    "scheduling_issue": "scheduling",
    "deceased": "a death in the family",
    "other": "another reason",
}


# The reason as the end of a sentence: "They cancelled because ..."
CANCEL_BECAUSE = {
    "price": "it costs too much",
    "moving": "they are moving",
    "service_quality": "they were not happy with the service",
    "pests_persist": "the pests kept coming back",
    "no_longer_needed": "they no longer need it",
    "switching_provider": "they are going to another company",
    "financial_hardship": "money is tight",
    "technician_issue": "of a problem with a technician",
    "scheduling_issue": "of problems with scheduling",
    "deceased": "of a death in the family",
}


def _rate(num: int, den: int) -> float | None:
    return round(num / den * 100, 1) if den else None


def _pct(value: float | None) -> str:
    return "no data" if value is None else f"{round(value)}%"


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _customer(row: Row) -> str:
    """The customer's name, or a description when the call never gave one."""
    name = (row.analysis.customer_name or "").strip()
    if name:
        return name
    return f"the caller on {row.call.external_ref}" if row.call.external_ref else "the caller"


def _lens(row: Row) -> str | None:
    return LENS_BY_CALL_TYPE.get(row.analysis.call_type)


def _age_days(when: datetime | None, now: datetime) -> int | None:
    return None if when is None else max(0, (now - when).days)


# --- Performance cards -----------------------------------------------------------


def _sales(rows: list[Row]) -> dict[str, Any]:
    sales = [r for r in rows if _lens(r) == "sales"]
    out = Counter(r.analysis.outcome for r in sales)
    decided = out["sold"] + out["follow_up"] + out["not_sold"]
    rate = _rate(out["sold"], decided)
    deciding = [r for r in sales if r.analysis.outcome == "follow_up"]
    lost = [r for r in sales if r.analysis.outcome == "not_sold"]
    if not sales:
        why = "No calls from new customers in this time."
    elif deciding:
        why = (f"{_plural(len(deciding), 'person is', 'people are')} still deciding. "
               "Call them back before they go somewhere else.")
    elif lost:
        why = f"{_plural(len(lost), 'person')} said no."
    else:
        why = "Everyone who called said yes."
    return {
        "key": "sales",
        "label": "New customers",
        "question": "Are new customers saying yes?",
        "metric_label": "Said yes",
        "value": rate,
        "count": out["sold"],
        "of": decided,
        "status": _judge("close_rate", rate, decided),
        "target": TARGETS["close_rate"].good,
        "goal": "Goal: at least 5 out of 10 say yes",
        "detail": (
            f"{out['sold']} said yes · {out['follow_up']} still deciding · "
            f"{out['not_sold']} said no{_few(decided)}" if sales else "No calls from new customers"
        ),
        "why": why,
        "action": (
            {"label": "See who to call back", "href": "/v2/pipeline"} if deciding else None
        ),
    }


def _retention(rows: list[Row]) -> dict[str, Any]:
    ret = [r for r in rows if _lens(r) == "retention"]
    out = Counter(r.analysis.outcome for r in ret)
    decided = out["saved"] + out["cancelled"]
    rate = _rate(out["saved"], decided)
    reasons = Counter(
        ((r.analysis.triage or {}).get("retention") or {}).get("cancel_reason") for r in ret
    )
    reasons.pop(None, None)
    reasons.pop("not_applicable", None)
    no_offer = [
        r for r in ret
        if r.analysis.outcome == "cancelled"
        and not ((r.analysis.triage or {}).get("retention") or {}).get("offers_made")
    ]
    action = None
    if not ret:
        why = "Nobody called to cancel in this time."
    elif no_offer:
        why = (f"{_plural(len(no_offer), 'customer')} cancelled and "
               f"{'was' if len(no_offer) == 1 else 'were'} never given a reason to stay.")
        action = {"label": "Listen to that call",
                  "href": f"/v2/calls/{no_offer[0].call.id}"}
    elif reasons:
        top, n = reasons.most_common(1)[0]
        why = f"The most common reason: {CANCEL_REASON_LABEL.get(top, top)} ({n})."
    else:
        why = "Every customer who wanted to cancel was helped."
    return {
        "key": "retention",
        "label": "Customers who want to cancel",
        "question": "Are we keeping them?",
        "metric_label": "Kept",
        "value": rate,
        "count": out["saved"],
        "of": decided,
        "status": _judge("save_rate", rate, decided),
        "target": TARGETS["save_rate"].good,
        "goal": "Goal: keep at least 6 out of 10",
        "detail": (
            f"{out['saved']} kept · {out['cancelled']} cancelled"
            + (f" · {out['pending']} not decided" if out["pending"] else "")
            + _few(decided)
            if ret else "Nobody called to cancel"
        ),
        "why": why,
        "action": action,
    }


def _service(rows: list[Row]) -> dict[str, Any]:
    svc = [r for r in rows if _lens(r) == "service"]
    out = Counter(r.analysis.outcome for r in svc)
    decided = out["resolved"] + out["partially"] + out["unresolved"]
    rate = _rate(out["resolved"], decided)
    open_ = [r for r in svc if r.analysis.outcome in ("unresolved", "partially")]
    if not svc:
        why = "No customers called with a problem in this time."
    elif open_:
        why = f"{_plural(len(open_), 'customer')} may still need help."
    else:
        why = "Every problem was fixed on the call."
    return {
        "key": "service",
        "label": "Customers with a problem",
        "question": "Did we fix it on the call?",
        "metric_label": "Fixed",
        "value": rate,
        "count": out["resolved"],
        "of": decided,
        "status": _judge("resolution_rate", rate, decided),
        "target": TARGETS["resolution_rate"].good,
        "goal": "Goal: fix almost all of them (more than 8 out of 10)",
        "detail": (
            f"{out['resolved']} fixed · {out['partially']} partly fixed · "
            f"{out['unresolved']} not fixed{_few(decided)}"
            if svc else "No customers with a problem"
        ),
        "why": why,
        "action": (
            {"label": "Listen to that call", "href": f"/v2/calls/{open_[0].call.id}"}
            if open_ else None
        ),
    }


def _quality(rows: list[Row]) -> dict[str, Any]:
    scored = [r for r in rows if r.pct is not None]
    avg = insights._avg([p for r in scored if (p := r.pct) is not None])
    meeting = sum(1 for r in scored if r.analysis.grade in ("gold", "green"))
    return {
        "key": "quality",
        "label": "Following the call steps",
        "question": "Does the team follow the PestLaunch call steps?",
        "metric_label": "Steps done",
        "value": avg,
        "count": meeting,
        "of": len(scored),
        "status": TARGETS["call_quality"].status(avg),
        "target": TARGETS["call_quality"].good,
        "goal": "Goal: do almost every step on every call",
        "detail": (
            f"{meeting} of {len(scored)} calls followed enough steps" if scored
            else "No calls checked yet"
        ),
        "why": "",
        "action": None,
        "meeting": meeting,
        "scored": len(scored),
    }


def _with_change(card: dict[str, Any], before: dict[str, Any] | None) -> dict[str, Any]:
    prior = before["value"] if before else None
    card["change"] = (
        round(card["value"] - prior, 1)
        if card["value"] is not None and prior is not None else None
    )
    return card


# --- Coaching ----------------------------------------------------------------------


@dataclass
class StepStat:
    key: str
    label: str
    quadrant: str
    met: int = 0
    seen: int = 0

    @property
    def hit_rate(self) -> float:
        return self.met / self.seen * 100 if self.seen else 0.0

    @property
    def missed(self) -> int:
        return self.seen - self.met


def step_stats(rows: list[Row]) -> dict[str, StepStat]:
    """Hit rate per step, ignoring steps the manual awards automatically."""
    stats: dict[str, StepStat] = {}
    for row in rows:
        for item in row.analysis.items or []:
            if item.get("auto_awarded") and not item.get("override"):
                continue
            key = str(item.get("key") or "")
            label = insights.step_label(item)
            stat = stats.setdefault(label, StepStat(key, label, str(item.get("quadrant") or "")))
            stat.seen += 1
            stat.met += 1 if item.get("awarded") else 0
    return stats


def focus_step(stats: dict[str, StepStat]) -> StepStat | None:
    """The one step to coach: missed most often, then on the most calls."""
    judged = [s for s in stats.values() if s.seen >= MIN_ATTEMPTS and s.missed]
    return min(judged, key=lambda s: (s.hit_rate, -s.seen), default=None)


def coached_step(rows: list[Row], stats: dict[str, StepStat]) -> StepStat | None:
    """With too few calls to see a pattern, the step the latest call's coaching targets."""
    by_key = {s.key: s for s in stats.values()}
    for row in sorted(rows, key=lambda r: r.when, reverse=True):
        for tip in (row.analysis.coaching or {}).get("coaching") or []:
            for key in tip.get("item_keys") or []:
                stat = by_key.get(key)
                if stat and stat.missed:
                    return stat
    return None


# Below this many scored calls a rep's pattern is a guess; they are listed last.
FEW_CALLS = 3


def strong_steps(stats: dict[str, StepStat], limit: int = 2) -> list[StepStat]:
    judged = [s for s in stats.values() if s.seen >= MIN_ATTEMPTS and s.hit_rate >= 60]
    return sorted(judged, key=lambda s: (-s.hit_rate, -s.seen))[:limit]


def _tip_for(rows: list[Row], step: StepStat) -> dict[str, Any] | None:
    """The best coaching moment for a step: what happened and what to say instead.

    A tip written mainly about this step wins over one that only mentions it
    alongside others; the most recent call breaks ties.
    """
    candidates = []
    for row in rows:
        for tip in (row.analysis.coaching or {}).get("coaching") or []:
            keys = tip.get("item_keys") or []
            if step.key in keys and tip.get("try_saying"):
                rank = (keys.index(step.key), len(keys), -row.when.timestamp())
                candidates.append((*rank, row, tip))
    for _, _, _, row, tip in sorted(candidates, key=lambda c: c[:3]):
        return {
            "call_id": str(row.call.id),
            "ref": row.call.external_ref,
            "customer": row.analysis.customer_name,
            "rep": row.call.rep.name if row.call.rep else row.analysis.rep_name,
            "title": tip.get("title"),
            "what_happened": tip.get("what_happened"),
            "try_saying": (tip.get("try_saying") or "").strip().strip('"“”'),
            "start": tip.get("start"),
        }
    return None


def _strength_example(rows: list[Row]) -> dict[str, Any] | None:
    for row in sorted(rows, key=lambda r: r.pct or 0, reverse=True):
        for s in (row.analysis.coaching or {}).get("strengths") or []:
            if s.get("verified", True) and s.get("title"):
                return {
                    "call_id": str(row.call.id),
                    "ref": row.call.external_ref,
                    "title": s.get("title"),
                    "detail": s.get("detail"),
                    "quote": s.get("quote"),
                    "start": s.get("start"),
                }
    return None


def _stat_out(s: StepStat) -> dict[str, Any]:
    plain, meaning = plain_step(s.key, s.label)
    return {"step": s.label, "plain": plain, "meaning": meaning, "key": s.key,
            "quadrant": s.quadrant, "met": s.met, "of": s.seen,
            "hit_rate": round(s.hit_rate, 1), "missed": s.missed}


def coaching(rows: list[Row]) -> dict[str, Any] | None:
    # The team's coaching is about the people on the phones, not the AI receptionist.
    scored = [r for r in rows if r.pct is not None and r.call.source != "twilio"]
    stats = step_stats(scored)
    focus = focus_step(stats)
    if focus is None:
        return None
    # Who misses it most, so the manager knows where to start.
    by_rep: dict[str, list[bool]] = defaultdict(list)
    for row in scored:
        name = row.call.rep.name if row.call.rep else (row.analysis.rep_name or "")
        for item in row.analysis.items or []:
            if insights.step_label(item) == focus.label and name:
                by_rep[name].append(bool(item.get("awarded")))
    reps = sorted(
        ({"rep": k, "missed": v.count(False), "of": len(v)} for k, v in by_rep.items()),
        key=lambda r: (-r["missed"], r["rep"]),
    )
    strengths = strong_steps(stats, limit=1)
    return {
        "focus": _stat_out(focus),
        "tip": _tip_for(scored, focus),
        "reps": [r for r in reps if r["missed"]][:4],
        "strength": _stat_out(strengths[0]) if strengths else None,
    }


# --- Pipeline actions ------------------------------------------------------------

# Follow-ups the office or rep owns that move a sale forward. Promises about the
# service itself (a technician visit, a treatment) are the customer's journey,
# not something the person working the pipeline has to do.
_SALES_VERBS = re.compile(
    r"\b(call|text|email|send|quote|follow[- ]?up|reach out|contact|check back|confirm|"
    r"schedule|book|agreement|price|pricing|discount)\b",
    re.IGNORECASE,
)
_SERVICE_ONLY = re.compile(r"^\s*(technician|tech|perform|conduct|treat|apply|inspect)", re.I)


def owner_promise(triage: dict[str, Any]) -> str | None:
    """A sales follow-up the rep or office promised on the last call, if any."""
    for f in triage.get("follow_ups") or []:
        action = (f.get("action") or "").strip()
        if (
            f.get("owner") in ("rep", "office")
            and action
            and _SALES_VERBS.search(action)
            and not _SERVICE_ONLY.match(action)
        ):
            return action
    return None


# Days after the last contact an open lead is due for its next touch, and
# after which it is going cold.
DUE_DAYS = {LeadStage.NEW: 1, LeadStage.QUOTED: 2, LeadStage.FOLLOW_UP: 2}
COLD_DAYS = 14

_MONEY = re.compile(r"\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)")


def quoted_value(price: str | None) -> float | None:
    match = _MONEY.search(price or "")
    return float(match.group(1).replace(",", "")) if match else None


def lead_action(
    lead: Lead, triage: dict[str, Any], now: datetime, *, booked: bool = False
) -> dict[str, Any] | None:
    """What the person working the pipeline should do next, or None once decided."""
    stage = lead.stage
    if stage in (LeadStage.WON, LeadStage.LOST):
        return None
    promise = owner_promise(triage)
    value = quoted_value(lead.price_quoted)
    name = lead.name
    if booked:
        label = f"Confirm {name}'s visit"
        why = f"{name} booked a visit with the AI receptionist. Call to make sure it's right."
    elif stage == LeadStage.QUOTED:
        label = f"Call {name} back"
        price = f" (${value:,.0f})" if value else ""
        why = f"{name} was given a price{price} and hasn't decided yet."
    elif stage == LeadStage.FOLLOW_UP:
        label, why = f"Call {name} back", f"{name} wanted time to think about it."
    else:
        label = f"Call {name}"
        why = f"{name} asked about a service. Nobody has talked it through with them yet."
    contact = lead.last_contact_at
    age = _age_days(contact, now)
    due = contact + timedelta(days=DUE_DAYS.get(LeadStage(stage), 2)) if contact else None
    if age is not None and age >= COLD_DAYS:
        urgency = "cold"
    elif due is not None and due.date() < now.date():
        urgency = "overdue"
    elif due is not None and due.date() == now.date():
        urgency = "today"
    else:
        urgency = "upcoming"
    return {
        "label": label,
        "why": why,
        "promised": promise,
        "due_at": due.isoformat() if due else None,
        "days_since_contact": age,
        "urgency": urgency,
    }


_URGENCY_ORDER = {"overdue": 0, "today": 1, "cold": 2, "upcoming": 3}
_STAGE_ORDER = {LeadStage.QUOTED: 0, LeadStage.FOLLOW_UP: 1, LeadStage.NEW: 2}


async def pipeline(session: AsyncSession, business_id: uuid.UUID) -> dict[str, Any]:
    now = datetime.now(UTC)
    rows = (
        await session.execute(
            select(Lead, Rep.name, CallAnalysis.triage, Call.source)
            .outerjoin(Rep, Rep.id == Lead.rep_id)
            .outerjoin(Call, Call.id == Lead.last_call_id)
            .outerjoin(CallAnalysis, CallAnalysis.call_id == Lead.last_call_id)
            .where(Lead.business_id == business_id)
        )
    ).all()
    open_, closed = [], []
    for lead, rep_name, triage, source in rows:
        triage = triage or {}
        booked = (
            source == "twilio"
            and lead.stage == LeadStage.NEW
            and bool((triage.get("appointment") or {}).get("booked"))
        )
        action = lead_action(lead, triage, now, booked=booked)
        item = {
            "id": str(lead.id),
            "name": lead.name,
            "stage": lead.stage,
            "stage_source": lead.stage_source,
            "service": lead.service,
            "price_quoted": lead.price_quoted,
            "value": quoted_value(lead.price_quoted),
            "pests": list(lead.pests or []),
            "rep": rep_name,
            "last_call_id": str(lead.last_call_id) if lead.last_call_id else None,
            "last_contact_at": lead.last_contact_at.isoformat() if lead.last_contact_at else None,
            "action": action,
        }
        (open_ if action else closed).append(item)
    open_.sort(key=lambda i: (
        _URGENCY_ORDER[i["action"]["urgency"]],
        _STAGE_ORDER.get(LeadStage(i["stage"]), 3),
        -(i["value"] or 0),
        i["last_contact_at"] or "",
    ))
    closed.sort(key=lambda i: i["last_contact_at"] or "", reverse=True)
    stages = Counter(i["stage"] for i in open_ + closed)
    won = [i for i in closed if i["stage"] == LeadStage.WON]
    return {
        "as_of": now.isoformat(),
        "funnel": [{"stage": s.value, "count": stages.get(s.value, 0)} for s in LeadStage],
        "open": open_,
        "closed": closed,
        "summary": {
            "open": len(open_),
            "needs_action": sum(1 for i in open_ if i["action"]["urgency"] != "upcoming"),
            "open_value": sum(i["value"] or 0 for i in open_),
            "won": len(won),
            "won_value": sum(i["value"] or 0 for i in won),
            "lost": stages.get(LeadStage.LOST, 0),
        },
    }


# --- The brief ---------------------------------------------------------------------


def _todo(
    rows: list[Row], leads: list[dict[str, Any]], follow_ups: list[tuple[FollowUp, Call, Any]]
) -> list[dict[str, Any]]:
    """Open work across the business, ranked; the page shows the top few."""
    items: list[dict[str, Any]] = []
    seen_calls: set[str] = set()

    for r in rows:
        retention = (r.analysis.triage or {}).get("retention") or {}
        if r.analysis.outcome == "cancelled" and not retention.get("offers_made"):
            because = CANCEL_BECAUSE.get(retention.get("cancel_reason") or "")
            name = (r.analysis.customer_name or "").strip()
            items.append({
                "kind": "retention",
                "priority": 100,
                "title": f"Try to win back {name or 'a customer who cancelled'}",
                "why": "They cancelled" + (f" because {because}" if because else "")
                + ". Nobody offered them a reason to stay.",
                "cta": "Listen to the call",
                "href": f"/v2/calls/{r.call.id}",
                "when": r.when.isoformat(),
            })
            seen_calls.add(str(r.call.id))

    for lead in leads:
        action = lead["action"]
        if action["urgency"] == "upcoming":
            continue
        base = {"overdue": 90, "today": 85, "cold": 60}[action["urgency"]]
        stage_bonus = {"quoted": 6, "follow_up": 4, "new": 2}.get(lead["stage"], 0)
        age = action["days_since_contact"]
        items.append({
            "kind": "sales",
            "priority": base + stage_bonus,
            "title": action["label"],
            "why": action["why"] + (f" Last talk: {_plural(age, 'day')} ago." if age else ""),
            "cta": "See call-back list",
            "href": "/v2/pipeline",
            "when": lead["last_contact_at"],
        })
        if lead["last_call_id"]:
            seen_calls.add(lead["last_call_id"])

    for r in rows:
        if r.analysis.outcome in ("unresolved", "partially") and str(r.call.id) not in seen_calls:
            items.append({
                "kind": "service",
                "priority": 70 if r.analysis.outcome == "unresolved" else 55,
                "title": f"Check on {_customer(r)}",
                "why": "Their problem was " + ("not fixed" if r.analysis.outcome == "unresolved"
                                                else "only partly fixed") + " on the call.",
                "cta": "Listen to the call",
                "href": f"/v2/calls/{r.call.id}",
                "when": r.when.isoformat(),
            })
            seen_calls.add(str(r.call.id))

    # Callbacks the office promised, not already covered above.
    for f, call, analysis in follow_ups:
        if str(call.id) in seen_calls or f.owner not in ("rep", "office"):
            continue
        if not _SALES_VERBS.search(f.action) or _SERVICE_ONLY.match(f.action):
            continue
        who = (analysis.customer_name if analysis else None) or call.external_ref or "a caller"
        items.append({
            "kind": "follow_up",
            "priority": 50,
            "title": f.action[:1].upper() + f.action[1:],
            "why": f"Promised to {who}." + (f" When: {f.due}." if f.due else ""),
            "cta": "Listen to the call",
            "href": f"/v2/calls/{call.id}",
            "when": (call.occurred_at or call.created_at).isoformat(),
        })
        seen_calls.add(str(call.id))

    return sorted(items, key=lambda i: (-i["priority"], i["when"] or ""))


def headline(
    cards: list[dict[str, Any]], coach: dict[str, Any] | None, todo: list[dict[str, Any]]
) -> dict[str, str]:
    """The verdict and the next step, without repeating the numbers on the cards.

    The title says what matters most in words; the detail says where to start
    and what to teach. Areas with too few calls to judge are left out.
    """
    behind = [c for c in cards[:3] if c["status"] == "bad"] + [
        c for c in cards[:3] if c["status"] == "watch"
    ]
    judged = [c for c in cards[:3] if c["status"] != "none"]
    quality = cards[3]
    skipping = quality["status"] in ("bad", "watch") and coach is not None

    if behind:
        title = VERDICTS[behind[0]["key"]][behind[0]["status"]] + "."
        if len(behind) > 1:
            others = " and ".join(VERDICTS[c["key"]][c["status"]].lower() for c in behind[1:])
            title += f" Also, {others}."
    elif judged and skipping:
        title = "Customers are being looked after, but calls are skipping key steps."
    elif judged:
        title = "Things are going well."
    else:
        title = "There are not enough calls yet to say how things are going."

    detail: list[str] = []
    if todo:
        detail.append(f"Start with: {todo[0]['title']}.")
    if skipping:
        detail.append(f"This week, teach the team to “{coach['focus']['plain'].lower()}”.")

    if behind and behind[0]["status"] == "bad" or (not behind and quality["status"] == "bad"):
        status = "bad"
    elif behind or skipping:
        status = "watch"
    elif judged:
        status = "good"
    else:
        status = "none"
    return {"status": status, "title": title, "detail": " ".join(detail)}


async def brief(session: AsyncSession, business_id: uuid.UUID, days: int | None) -> dict:
    now = datetime.now(UTC)
    window = await insights.load(session, business_id, days=days * 2 if days else None)
    since = now - timedelta(days=days) if days else None
    rows = [r for r in window if since is None or r.when >= since]
    before = [r for r in window if since is not None and r.when < since]

    builders = (_sales, _retention, _service, _quality)
    cards = [
        _with_change(build(rows), build(before) if before else None) for build in builders
    ]
    coach = coaching(rows)

    board = await pipeline(session, business_id)
    follow_ups = (
        await session.execute(
            select(FollowUp, Call, CallAnalysis)
            .join(Call, Call.id == FollowUp.call_id)
            .outerjoin(CallAnalysis, CallAnalysis.call_id == Call.id)
            .where(FollowUp.business_id == business_id, FollowUp.status == "open")
            .order_by(FollowUp.created_at.desc())
        )
    ).all()
    todo = _todo(rows, board["open"], [tuple(f) for f in follow_ups])

    status_counts = dict(
        (
            await session.execute(
                select(Call.processing_status, func.count(Call.id))
                .where(Call.business_id == business_id,
                       or_(Call.audio_path.isnot(None), Call.stt_provider.isnot(None)))
                .group_by(Call.processing_status)
            )
        ).all()
    )
    disputed = sum(1 for r in rows if insights.disputed_steps(r.analysis.items or []))
    review = sum(1 for r in rows if insights.needs_review(r))
    return {
        "as_of": now.isoformat(),
        "days": days,
        "headline": headline(cards, coach, todo),
        "cards": cards,
        # The page shows the top five and can expand to the rest.
        "todo": todo[:15],
        "todo_total": len(todo),
        "coaching": coach,
        "review": {"disputed_calls": disputed, "type_checks": review},
        "calls": {
            "analyzed": len(rows),
            "processing": sum(v for k, v in status_counts.items()
                              if k not in (ProcessingStatus.DONE, ProcessingStatus.FAILED)),
            "failed": status_counts.get(ProcessingStatus.FAILED, 0),
        },
    }


# --- Reps ----------------------------------------------------------------------------


def _trend(scored: list[Row]) -> str | None:
    """Recent calls against earlier ones: up, down or steady."""
    ordered = sorted(scored, key=lambda r: r.when)
    if len(ordered) < 4:
        return None
    half = len(ordered) // 2
    early = sum(r.pct or 0 for r in ordered[:half]) / half
    late = sum(r.pct or 0 for r in ordered[half:]) / (len(ordered) - half)
    if late - early >= 5:
        return "up"
    if early - late >= 5:
        return "down"
    return "steady"


def rep_card(rep: Rep, rows: list[Row]) -> dict[str, Any]:
    scored = [r for r in rows if r.pct is not None]
    stats = step_stats(scored)
    focus = focus_step(stats) or coached_step(scored, stats)
    strong = strong_steps(stats, limit=2)
    avg = insights._avg([p for r in scored if (p := r.pct) is not None])
    sales = [r for r in rows if _lens(r) == "sales"]
    out = Counter(r.analysis.outcome for r in sales)
    decided = out["sold"] + out["follow_up"] + out["not_sold"]
    return {
        "id": str(rep.id),
        "name": rep.name,
        "calls": len(rows),
        "scored": len(scored),
        "score": avg,
        "status": TARGETS["call_quality"].status(avg),
        "trend": _trend(scored),
        "meeting_standard": sum(1 for r in scored if r.analysis.grade in ("gold", "green")),
        "close_rate": _rate(out["sold"], decided),
        "sales_calls": len(sales),
        "focus": _stat_out(focus) if focus else None,
        "strengths": [_stat_out(s) for s in strong],
    }


def _verdict(card: dict[str, Any]) -> str:
    name = card["name"]
    if not card["scored"]:
        return f"No calls from {name} have been checked yet."
    score = card["score"] or 0
    tens = round(score / 10)
    trend = {"up": " and getting better", "down": " and getting worse",
             "steady": ""}.get(card["trend"] or "", "")
    parts = [f"{name} does about {tens} out of 10 call steps{trend}."]
    if card["strengths"]:
        parts.append(f"Good at: {card['strengths'][0]['plain']}.")
    if card["focus"]:
        f = card["focus"]
        calls = "their only checked call" if f["of"] == 1 else f"{f['missed']} of {f['of']} calls"
        parts.append(f"Needs work on: {f['plain']} (skipped on {calls}).")
    if card["scored"] < FEW_CALLS:
        parts.append(f"This is based on only {_plural(card['scored'], 'call')}, "
                     "so it may change.")
    return " ".join(parts)


async def reps(session: AsyncSession, business_id: uuid.UUID, days: int | None) -> list[dict]:
    rows = await insights.load(session, business_id, days=days)
    by_rep: dict[uuid.UUID, list[Row]] = defaultdict(list)
    for r in rows:
        if r.call.rep_id:
            by_rep[r.call.rep_id].append(r)
    reps_ = (await session.scalars(select(Rep).where(Rep.business_id == business_id))).all()
    cards = [rep_card(rep, by_rep[rep.id]) for rep in reps_ if by_rep.get(rep.id)]
    # Most in need of coaching first: lowest score, then most calls. Reps with
    # only a call or two come after, since one call says little.
    return sorted(cards, key=lambda c: (c["scored"] < FEW_CALLS,
                                        c["score"] if c["score"] is not None else 101,
                                        -c["calls"]))


async def rep_brief(
    session: AsyncSession, business_id: uuid.UUID, rep_id: uuid.UUID, days: int | None
) -> dict[str, Any] | None:
    rep = await session.get(Rep, rep_id)
    if rep is None or rep.business_id != business_id:
        return None
    rows = await insights.load(session, business_id, days=days, rep_id=rep_id)
    scored = [r for r in rows if r.pct is not None]
    card = rep_card(rep, rows)
    stats = step_stats(scored)
    focus = focus_step(stats) or coached_step(scored, stats)
    team = await insights.load(session, business_id, days=days)
    team_scored = [r for r in team if r.pct is not None]
    team_avg = insights._avg([p for r in team_scored if (p := r.pct) is not None])

    # Steps by quadrant, for the detail view.
    order = {key: i for sc in SCORECARDS.values() for i, key in
             enumerate(item.key for item in sc.items)}
    steps = sorted((_stat_out(s) for s in stats.values()),
                   key=lambda s: (order.get(s["key"], 99), s["step"]))
    return {
        **card,
        "verdict": _verdict(card),
        "team_score": team_avg,
        "coach": _tip_for(scored, focus) if focus else None,
        "strength_example": _strength_example(scored),
        "steps": steps,
        "calls_list": [
            {"call_id": str(r.call.id), "ref": r.call.external_ref,
             "customer": r.analysis.customer_name, "when": r.when.isoformat(),
             "score": round(r.pct, 1) if r.pct is not None else None,
             "grade": r.analysis.grade, "call_type": r.analysis.call_type,
             "outcome": r.analysis.outcome}
            for r in sorted(rows, key=lambda r: r.when, reverse=True)
        ],
    }
