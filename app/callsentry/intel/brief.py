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

from callsentry.config import get_settings
from callsentry.intel import insights, phones
from callsentry.intel.insights import Row
from callsentry.intel.rubrics import LENS_BY_CALL_TYPE, SCORECARDS
from callsentry.models import (
    Call,
    CallAnalysis,
    FollowUp,
    Lead,
    LeadStage,
    OwnerAction,
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


# Each goal is a platform setting (Settings → Goals), read live so a change
# shows on the next page load. Below the goal by up to 15 points is "could be
# better"; further below is "needs work".
_GOAL_SETTINGS = {
    "close_rate": "goal_close_rate",
    "save_rate": "goal_save_rate",
    "resolution_rate": "goal_fix_rate",
    "call_quality": "goal_call_steps",
}


class _Targets:
    def __getitem__(self, key: str) -> Target:
        good = float(getattr(get_settings(), _GOAL_SETTINGS[key]))
        return Target(good=good, watch=max(0.0, good - 15))


TARGETS = _Targets()


def goal_text(key: str, ending: str) -> str:
    """'Goal: at least 6 out of 10 kept' - tens when the goal is round, else out of 100."""
    good = TARGETS[key].good
    share = f"{good / 10:g} out of 10" if good % 10 == 0 else f"{good:g} out of 100"
    return f"Goal: at least {share} {ending}"

# Everyday names for the scorecard steps, so anyone can read them. The manual's
# own names ("Expectation Statement") mean little outside a training session.
PLAIN_STEPS: dict[str, tuple[str, str]] = {
    "validate": ("Show you care", "Say you're sorry about their exact problem."),
    "confidence_statement": ("Promise to help", "Tell them you will take care of it."),
    "expectation_statement_1": ("Say what you'll ask", "Tell them you'll ask a few questions."),
    "investigate": ("Ask questions", "Ask what, where and when to understand the problem."),
    "summary_statement": ("Repeat it back", "Say their problem back in your own words."),
    "expectation_statement_2": ("Explain the plan",
                                "Before offering the fix, say what comes next."),
    "present_solution": ("Offer the fix", "Explain what you'll do and why it helps them."),
    "consensus": ("Check they agree", "Ask if it makes sense or if they have questions."),
    "close": ("Ask for a yes",
              "Ask them to book or agree the next step, like morning or afternoon."),
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


# Steps the cancellation scorecard shares by name but judges differently: there
# the "solution" is a save offer. They are counted and coached apart.
RETENTION_PLAIN: dict[str, tuple[str, str]] = {
    "investigate": ("Ask why they're leaving", "Ask open questions to find the real reason."),
    "present_solution": ("Make a save offer",
                         "Offer something that fixes their reason for leaving."),
    "consensus": ("Check the offer works", "Ask if the offer works for them."),
    "provide_conclusion": ("Say what happens next", "Confirm what was done and the next step."),
}


def plain_step(key: str, fallback: str = "", scorecard: str | None = None) -> tuple[str, str]:
    if scorecard == "retention" and key in RETENTION_PLAIN:
        return RETENTION_PLAIN[key]
    return PLAIN_STEPS.get(key, (fallback or key, ""))


def _step_scope(row: Row, key: str) -> str | None:
    """"retention" when this step means something else on this call's scorecard."""
    retention = row.analysis.scorecard_key == "retention"
    return "retention" if retention and key in RETENTION_PLAIN else None


def _counts(item: dict[str, Any]) -> bool:
    """A step that says something about the rep: not awarded by rule, and not one
    the two models still disagree on with nobody having decided it."""
    if item.get("override"):
        return True
    return not item.get("auto_awarded") and item.get("agreement") != "disputed"



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


# What the analysis writes when the caller never said their name.
_NO_NAME = {
    "unknown", "unknown caller", "unknown customer", "not given", "not provided",
    "not stated", "not mentioned", "n/a", "na", "none", "null", "caller", "customer",
    "anonymous", "unnamed", "-",
}


def real_name(raw: str | None) -> str:
    """A customer's name, or "" when the call never gave one."""
    name = (raw or "").strip().strip('."\'')
    return "" if name.lower() in _NO_NAME else name


def _customer(row: Row) -> str:
    """The customer's name, or a description when the call never gave one."""
    name = real_name(row.analysis.customer_name)
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
        "goal": goal_text("close_rate", "say yes"),
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
        "goal": goal_text("save_rate", "kept"),
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
        "goal": goal_text("resolution_rate", "fixed on the call"),
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
    # The team's call steps, as in its coaching: the AI receptionist is apart.
    scored = [r for r in rows if r.pct is not None and r.call.source != "twilio"]
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
        "status": _judge("call_quality", avg, len(scored)),
        "target": TARGETS["call_quality"].good,
        "goal": goal_text("call_quality", "steps done"),
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
    scope: str | None = None
    met: int = 0
    seen: int = 0

    @property
    def hit_rate(self) -> float:
        return self.met / self.seen * 100 if self.seen else 0.0

    @property
    def missed(self) -> int:
        return self.seen - self.met


def _step_id(row: Row, item: dict[str, Any]) -> str:
    label = insights.step_label(item)
    return f"{label} (cancellations)" if _step_scope(row, str(item.get("key") or "")) else label


def step_stats(rows: list[Row]) -> dict[str, StepStat]:
    """Hit rate per step, over the steps that say something about the rep."""
    stats: dict[str, StepStat] = {}
    for row in rows:
        for item in row.analysis.items or []:
            if not _counts(item):
                continue
            key = str(item.get("key") or "")
            label = _step_id(row, item)
            stat = stats.setdefault(
                label, StepStat(key, label, str(item.get("quadrant") or ""), _step_scope(row, key))
            )
            stat.seen += 1
            stat.met += 1 if item.get("awarded") else 0
    return stats


def _missed_on(row: Row, step: StepStat) -> bool:
    """This call is one where the step, as `step` means it, was missed."""
    return any(
        i.get("key") == step.key and not i.get("awarded") and _step_id(row, i) == step.label
        for i in row.analysis.items or []
    )


def focus_step(stats: dict[str, StepStat]) -> StepStat | None:
    """The one step to coach: missed most often, then on the most calls."""
    judged = [s for s in stats.values() if s.seen >= MIN_ATTEMPTS and s.missed]
    return min(judged, key=lambda s: (s.hit_rate, -s.seen), default=None)


def coached_step(rows: list[Row], stats: dict[str, StepStat]) -> StepStat | None:
    """With too few calls to see a pattern, the step the latest call's coaching targets."""
    for row in sorted(rows, key=lambda r: r.when, reverse=True):
        for tip in (row.analysis.coaching or {}).get("coaching") or []:
            for key in tip.get("item_keys") or []:
                stat = next(
                    (s for s in stats.values() if s.key == key and _missed_on(row, s)), None
                )
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
            # Only from a call where this step was really missed, on a
            # scorecard where it means the same thing.
            if step.key in keys and tip.get("try_saying") and _missed_on(row, step):
                rank = (keys.index(step.key), len(keys), -row.when.timestamp())
                candidates.append((*rank, row, tip))
    for _, _, _, row, tip in sorted(candidates, key=lambda c: c[:3]):
        return {
            "call_id": str(row.call.id),
            "ref": row.call.external_ref,
            "customer": real_name(row.analysis.customer_name) or None,
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
    plain, meaning = plain_step(s.key, s.label, s.scope)
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
            if _step_id(row, item) == focus.label and _counts(item) and name:
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


_MONTHLY = re.compile(r"^\s*(/\s*mo\b|a month|per month|monthly|each month|every month|/month|"
                      r"per mo\b|a mo\b)", re.I)
_QUARTERLY = re.compile(r"^\s*(/\s*q(tr)?\b|a quarter|per quarter|quarterly|each quarter|"
                        r"every quarter|per visit quarterly)", re.I)
_YEARLY = re.compile(r"^\s*(/\s*yr\b|a year|per year|yearly|annually|for a year|for the year|"
                     r"each year|every year)", re.I)
_PER_YEAR = ((_MONTHLY, 12), (_QUARTERLY, 4), (_YEARLY, 1))


def yearly_value(price: str | None) -> float | None:
    """What a quote is worth over its first year, so quotes can be added up.

    A quote is often two prices: "$649 initial service; $59 per month for the
    plan". Each amount is read with the words right after it, so that one is
    $649 once plus $59 x 12 = $1,357, not $649 a month. The first one-off
    price and the first recurring price count; later amounts are usually the
    same plan said another way (a yearly total, a discount).
    """
    one_off: float | None = None
    recurring: float | None = None
    for match in _MONEY.finditer(price or ""):
        amount = float(match.group(1).replace(",", ""))
        after = (price or "")[match.end():match.end() + 24]
        per_year = next((n for pattern, n in _PER_YEAR if pattern.search(after)), None)
        if per_year is None:
            if one_off is None:
                one_off = amount
        elif recurring is None:
            recurring = amount * per_year
    if one_off is None and recurring is None:
        return None
    return (one_off or 0) + (recurring or 0)


def money(amount: float) -> str:
    return f"${amount:,.0f}"


def _about(pests: list[str], service: str | None) -> str:
    """What a customer called about, in a few words: "the ants", "termite treatment"."""
    names = [p.strip().lower() for p in pests if p and p.strip()][:2]
    if names:
        return "the " + " and ".join(names)
    return (service or "").strip().lower() or "your pest problem"


def lead_action(
    lead: Lead, triage: dict[str, Any], now: datetime, *, booked: bool = False
) -> dict[str, Any] | None:
    """What the person working the pipeline should do next, or None once decided."""
    stage = lead.stage
    if stage in (LeadStage.WON, LeadStage.LOST):
        return None
    promise = owner_promise(triage)
    value = quoted_value(lead.price_quoted)
    name = real_name(lead.name) or "the caller"
    who = name[:1].upper() + name[1:]
    if booked:
        label = f"Confirm {name}'s visit"
        why = f"{who} booked a visit with the AI receptionist. Call to make sure it's right."
    elif stage == LeadStage.QUOTED:
        label = f"Call {name} back"
        price = f" (${value:,.0f})" if value else ""
        why = f"{who} was given a price{price} and hasn't decided yet."
    elif stage == LeadStage.FOLLOW_UP:
        label, why = f"Call {name} back", f"{who} wanted time to think about it."
    else:
        label = f"Call {name}"
        why = f"{who} asked about a service. Nobody has talked it through with them yet."
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
            select(Lead, Rep.name, CallAnalysis.triage, Call.source, Call.caller_number)
            .outerjoin(Rep, Rep.id == Lead.rep_id)
            .outerjoin(Call, Call.id == Lead.last_call_id)
            .outerjoin(CallAnalysis, CallAnalysis.call_id == Lead.last_call_id)
            .where(Lead.business_id == business_id)
        )
    ).all()
    open_: list[dict[str, Any]] = []
    closed: list[dict[str, Any]] = []
    for lead, rep_name, triage, source, caller_number in rows:
        triage = triage or {}
        booked = (
            source == "twilio"
            and lead.stage == LeadStage.NEW
            and bool((triage.get("appointment") or {}).get("booked"))
        )
        action = lead_action(lead, triage, now, booked=booked)
        item = {
            "id": str(lead.id),
            "name": real_name(lead.name) or "Name not given",
            "stage": lead.stage,
            "stage_source": lead.stage_source,
            "service": lead.service,
            "price_quoted": lead.price_quoted,
            "value": quoted_value(lead.price_quoted),
            "yearly": yearly_value(lead.price_quoted),
            "pests": list(lead.pests or []),
            "rep": rep_name,
            "rep_id": str(lead.rep_id) if lead.rep_id else None,
            # Leads made before numbers were kept fall back to their latest call.
            "phone": lead.phone or phones.normalize(triage.get("customer_phone")) or (
                phones.normalize(caller_number) if source == "twilio" else None),
            "appointment": (triage.get("appointment") or {}).get("when") or None,
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
            # Yearly value: what the open quotes are worth, and how much of it
            # is late or going cold.
            "open_yearly": sum(i["yearly"] or 0 for i in open_),
            "at_risk_yearly": sum(i["yearly"] or 0 for i in open_
                                  if i["action"]["urgency"] in ("overdue", "cold")),
            "at_risk_count": sum(1 for i in open_
                                 if i["action"]["urgency"] in ("overdue", "cold")),
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
            name = real_name(r.analysis.customer_name)
            items.append({
                "key": f"winback:{r.call.id}",
                "kind": "retention",
                "priority": 100,
                "title": f"Try to win back {name or 'a customer who cancelled'}",
                "why": "They cancelled" + (f" because {because}" if because else "")
                + ". Nobody offered them a reason to stay.",
                "cta": "Listen to the call",
                "href": f"/v2/calls/{r.call.id}",
                "when": r.when.isoformat(),
                "value": None,
                "context": _call_context(r, "winback"),
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
            "key": f"lead:{lead['id']}:{lead['last_call_id']}",
            "kind": "sales",
            "priority": base + stage_bonus,
            "title": action["label"],
            "why": action["why"] + (f" Last talk: {_plural(age, 'day')} ago." if age else ""),
            "cta": "See call-back list",
            "href": "/v2/pipeline",
            "when": lead["last_contact_at"],
            "value": lead.get("yearly"),
            "context": {
                "situation": "confirm" if action["label"].startswith("Confirm") else lead["stage"],
                "customer": lead["name"] if lead["name"] != "Name not given" else "",
                "phone": lead.get("phone"),
                "rep": lead.get("rep"),
                "rep_id": lead.get("rep_id"),
                "lead_id": lead["id"],
                "call_id": lead["last_call_id"],
                "about": _about(lead.get("pests") or [], lead.get("service")),
                "price": lead.get("value"),
                "when": lead.get("appointment"),
            },
        })
        if lead["last_call_id"]:
            seen_calls.add(lead["last_call_id"])

    for r in rows:
        if r.analysis.outcome in ("unresolved", "partially") and str(r.call.id) not in seen_calls:
            items.append({
                "key": f"service:{r.call.id}",
                "kind": "service",
                "priority": 70 if r.analysis.outcome == "unresolved" else 55,
                "title": f"Check on {_customer(r)}",
                "why": "Their problem was " + ("not fixed" if r.analysis.outcome == "unresolved"
                                                else "only partly fixed") + " on the call.",
                "cta": "Listen to the call",
                "href": f"/v2/calls/{r.call.id}",
                "when": r.when.isoformat(),
                "value": None,
                "context": _call_context(r, "checkin"),
            })
            seen_calls.add(str(r.call.id))

    # Callbacks the office promised, not already covered above.
    for f, call, analysis in follow_ups:
        if str(call.id) in seen_calls or f.owner not in ("rep", "office"):
            continue
        if not _SALES_VERBS.search(f.action) or _SERVICE_ONLY.match(f.action):
            continue
        named = real_name(analysis.customer_name) if analysis else ""
        who = named or call.external_ref or "a caller"
        triage = (analysis.triage if analysis else None) or {}
        items.append({
            "key": f"promise:{f.id}",
            "kind": "follow_up",
            "priority": 50,
            "title": f.action[:1].upper() + f.action[1:],
            "why": f"Promised to {who}." + (f" When: {f.due}." if f.due else ""),
            "cta": "Listen to the call",
            "href": f"/v2/calls/{call.id}",
            "when": (call.occurred_at or call.created_at).isoformat(),
            "value": None,
            "context": {
                "situation": "promise",
                "customer": named,
                "phone": phones.for_call(call, analysis),
                "rep": call.rep.name if call.rep else None,
                "rep_id": str(call.rep_id) if call.rep_id else None,
                "call_id": str(call.id),
                "about": _about(triage.get("pests") or [],
                                (triage.get("service") or {}).get("request")),
                "promise": f.action,
            },
        })
        seen_calls.add(str(call.id))

    return sorted(items, key=lambda i: (-i["priority"], i["when"] or ""))


def _call_context(r: Row, situation: str) -> dict[str, Any]:
    triage = r.analysis.triage or {}
    service = (triage.get("service") or {}).get("request") or (
        (triage.get("sales") or {}).get("service_discussed"))
    return {
        "situation": situation,
        "customer": real_name(r.analysis.customer_name),
        "phone": phones.for_call(r.call, r.analysis),
        "rep": r.call.rep.name if r.call.rep else r.analysis.rep_name,
        "rep_id": str(r.call.rep_id) if r.call.rep_id else None,
        "call_id": str(r.call.id),
        "about": _about(triage.get("pests") or [], service),
    }


def without_handled(summary: dict[str, Any], open_leads: list[dict[str, Any]],
                    handled: set[str]) -> dict[str, Any]:
    """The pipeline summary, not counting a lead someone has just followed up
    on as slipping: the owner has done what they can for now."""
    slipping = [i for i in open_leads if i["action"]["urgency"] in ("overdue", "cold")
                and i["id"] not in handled]
    return {**summary, "at_risk_yearly": sum(i["yearly"] or 0 for i in slipping),
            "at_risk_count": len(slipping)}


async def recently_handled_leads(session: AsyncSession, business_id: uuid.UUID) -> set[str]:
    since = datetime.now(UTC) - timedelta(days=HANDLED_DAYS)
    keys = await session.scalars(
        select(OwnerAction.item_key).where(
            OwnerAction.business_id == business_id, OwnerAction.status == "done",
            OwnerAction.done_at >= since, OwnerAction.item_key.like("lead:%"))
    )
    return {k.split(":")[1] for k in keys}


def money_line(summary: dict[str, Any]) -> str | None:
    """Open quotes in dollars, and how much of it is slipping."""
    at_risk, count = summary.get("at_risk_yearly") or 0, summary.get("at_risk_count") or 0
    total = summary.get("open_yearly") or 0
    if at_risk >= 1:
        return (f"{money(at_risk)} a year in quotes is slipping: "
                f"{_plural(count, 'customer')} waiting too long for a call back.")
    if total >= 1:
        return f"{money(total)} a year in quotes is waiting on an answer."
    return None


def headline(
    cards: list[dict[str, Any]], coach: dict[str, Any] | None, todo: list[dict[str, Any]],
    money_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
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
        detail.append(f"Most urgent today: {todo[0]['title']}.")
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
    return {"status": status, "title": title, "detail": " ".join(detail),
            "money": money_line(money_summary or {})}


def accuracy(rows: list[Row]) -> dict[str, Any] | None:
    """How often managers kept the AI's step verdicts, on the calls they corrected.

    Counts the model's own verdicts only: automatic awards are rules, and a
    step the two models disputed was never the AI's call, so a manager
    deciding it isn't a correction. Calls a manager read but didn't change
    leave no trace, so this can only understate the agreement.
    """
    calls = steps = changed = 0
    for r in rows:
        overrides = r.analysis.overrides or {}
        if not overrides:
            continue
        calls += 1
        for item in r.analysis.items or []:
            if item.get("auto_awarded") or item.get("agreement") == "disputed":
                continue
            model = item.get("model_status", item.get("status"))
            if model not in ("met", "missed"):
                continue
            steps += 1
            override = overrides.get(item.get("key", ""))
            if override and override.get("status") != model:
                changed += 1
    if not steps:
        return None
    return {"calls": calls, "steps": steps, "kept": steps - changed,
            "pct": round((steps - changed) / steps * 100, 1)}


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
    await attach_actions(session, business_id, todo)
    summary = without_handled(board["summary"], board["open"],
                              await recently_handled_leads(session, business_id))

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
        "headline": headline(cards, coach, [t for t in todo if not t.get("handled")], summary),
        "money": {k: summary[k] for k in
                  ("open_yearly", "at_risk_yearly", "at_risk_count", "won_value")},
        "cards": cards,
        # The page shows the top five and can expand to the rest.
        "todo": todo[:15],
        "todo_total": len(todo),
        "coaching": ({**coach, "delivery": await coaching_delivery(session, business_id)}
                     if coach else None),
        "review": {"disputed_calls": disputed, "type_checks": review},
        "accuracy": accuracy(rows),
        "calls": {
            "analyzed": len(rows),
            "processing": sum(v for k, v in status_counts.items()
                              if k not in (ProcessingStatus.DONE, ProcessingStatus.FAILED)),
            "failed": status_counts.get(ProcessingStatus.FAILED, 0),
        },
    }


HANDLED_DAYS = 3


def action_out(a: OwnerAction) -> dict[str, Any]:
    return {
        "id": str(a.id), "kind": a.kind, "status": a.status, "label": a.label,
        "to_name": a.to_name, "to_phone": a.to_phone, "to_phone_pretty": phones.pretty(a.to_phone),
        "body": a.body, "done_at": a.done_at.isoformat() if a.done_at else None,
        "done_by": a.done_by, "auto": a.auto, "error": a.error,
        "reply_text": a.reply_text,
        "replied_at": a.replied_at.isoformat() if a.replied_at else None,
    }


async def attach_actions(
    session: AsyncSession, business_id: uuid.UUID, todo: list[dict[str, Any]]
) -> None:
    """Give each to-do its prepared actions, and mark the ones already handled.

    A handled item sinks to the bottom with what was done, so the owner sees
    the work happen instead of the item vanishing.
    """
    keys = [t["key"] for t in todo if t.get("key")]
    rows = list(await session.scalars(
        select(OwnerAction).where(OwnerAction.business_id == business_id,
                                  OwnerAction.item_key.in_(keys))
    )) if keys else []
    by_key: dict[str, list[OwnerAction]] = defaultdict(list)
    for a in rows:
        by_key[a.item_key].append(a)
    recent = datetime.now(UTC) - timedelta(days=HANDLED_DAYS)
    for t in todo:
        t.pop("context", None)
        options = by_key.get(t.get("key") or "", [])
        done = [a for a in options if a.status == "done" and a.done_at and a.done_at >= recent]
        t["actions"] = [action_out(a) for a in sorted(options, key=lambda a: a.priority,
                                                      reverse=True)
                        if a.status in ("proposed", "failed")]
        t["handled"] = action_out(max(done, key=lambda a: a.done_at or recent)) if done else None
    todo.sort(key=lambda t: (t["handled"] is not None, -t["priority"], t["when"] or ""))


def iso_week(now: datetime) -> str:
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


async def coaching_delivery(session: AsyncSession, business_id: uuid.UUID) -> dict[str, Any]:
    """This week's coaching texts: how many went out, were opened, were played."""
    week = iso_week(datetime.now(UTC))
    rows = list(await session.scalars(
        select(OwnerAction).where(OwnerAction.business_id == business_id,
                                  OwnerAction.kind == "coach_rep",
                                  OwnerAction.item_key.like(f"coach:%:{week}"))
    ))
    sent = [a for a in rows if a.status == "done"]
    return {
        "week": week,
        "sent": len(sent),
        "opened": sum(1 for a in sent if a.opened_at),
        "listened": sum(1 for a in sent if a.listened_at),
        "waiting": sum(1 for a in rows if a.status in ("proposed", "failed")),
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
    team_scored = [r for r in team if r.pct is not None and r.call.source != "twilio"]
    team_avg = insights._avg([p for r in team_scored if (p := r.pct) is not None])

    # Steps by quadrant, for the detail view.
    order = {key: i for sc in SCORECARDS.values() for i, key in
             enumerate(item.key for item in sc.items)}
    steps = sorted((_stat_out(s) for s in stats.values()),
                   key=lambda s: (order.get(s["key"], 99), s["step"]))
    return {
        **card,
        "verdict": _verdict(card),
        "phone": rep.phone,
        "phone_pretty": phones.pretty(rep.phone),
        "team_score": team_avg,
        "coach": _tip_for(scored, focus) if focus else None,
        "strength_example": _strength_example(scored),
        "steps": steps,
        "calls_list": [
            {"call_id": str(r.call.id), "ref": r.call.external_ref,
             "customer": real_name(r.analysis.customer_name) or None, "when": r.when.isoformat(),
             "score": round(r.pct, 1) if r.pct is not None else None,
             "grade": r.analysis.grade, "call_type": r.analysis.call_type,
             "outcome": r.analysis.outcome}
            for r in sorted(rows, key=lambda r: r.when, reverse=True)
        ],
    }
