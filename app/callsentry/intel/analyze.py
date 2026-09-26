"""Classify, extract, score and coach one transcribed call.

Two passes:

  1. Triage - who is the rep, what kind of call is it, what happened
     (outcome, objections, cancel reason, follow-ups ...).
  2. Scoring - the scorecard for that call type, judged item by item with
     quotes cited by segment id, plus coaching for the rep.

The model judges; the code decides. Scorecard selection, automatic awards,
totals, grades, timestamps and quote verification are all computed here, so
a grade can always be traced back to the lines of the call that earned it.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import Any

import structlog

from callsentry.config import get_settings
from callsentry.intel import rubrics
from callsentry.intel.rubrics import CallType, Scorecard
from callsentry.intel.transcript import (
    CUSTOMER,
    REP,
    UNKNOWN,
    Segment,
    apply_roles,
    render,
    resolve_evidence,
)
from callsentry.services.llm import LLMResult, get_llm

log = structlog.get_logger(__name__)

# Bump when a prompt or schema changes, so re-scored calls can be told apart.
PROMPT_VERSION = "2026-09-26.3"

SOLUTION_BANK = [
    "free_reservice",
    "back_to_back_services",
    "custom_service_plan",
    "waive_payment",
    "set_day_time_technician",
    "account_hold",
    "service_manager_visit",
    "branch_manager_visit",
    "price_drop",
    "other",
]

CANCEL_REASONS = [
    "price",
    "moving",
    "service_quality",
    "pests_persist",
    "no_longer_needed",
    "switching_provider",
    "financial_hardship",
    "technician_issue",
    "scheduling_issue",
    "deceased",
    "other",
    "not_applicable",
]

_EVIDENCE = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "segment_id": {"type": "integer"},
            "quote": {"type": "string"},
        },
        "required": ["segment_id", "quote"],
        "additionalProperties": False,
    },
}


def _obj(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def _enum(*values: str) -> dict[str, Any]:
    return {"type": "string", "enum": list(values)}


TRIAGE_SCHEMA: dict[str, Any] = _obj(
    {
        "speaker_roles": {
            "type": "array",
            "description": "One entry per SPEAKER label in the transcript. Empty if unlabeled.",
            "items": _obj(
                {"speaker": {"type": "string"}, "role": _enum("rep", "customer", "other")}
            ),
        },
        "rep_segment_ids": {
            "type": "array",
            "description": "Only when the transcript has no speaker labels: ids of every "
            "segment spoken by the company's rep. Empty otherwise.",
            "items": {"type": "integer"},
        },
        "rep_name": {"type": "string"},
        "rep_name_segment_id": {"type": "integer"},
        "customer_name": {"type": "string"},
        "company_name": {"type": "string"},
        "direction": _enum("inbound", "outbound", "unknown"),
        "call_type": _enum(*[t.value for t in CallType]),
        "call_type_confidence": {"type": "number"},
        "call_type_reason": {"type": "string"},
        "not_scorable_reason": _enum(
            "none", "voicemail", "wrong_number", "solicitor_or_vendor", "internal",
            "no_conversation", "other"
        ),
        "summary": {"type": "string"},
        "customer_wins": {"type": "array", "items": {"type": "string"}},
        "pests": {"type": "array", "items": {"type": "string"}},
        "sales": _obj(
            {
                "outcome": _enum("sold", "follow_up", "not_sold", "not_applicable"),
                "service_discussed": {"type": "string"},
                "price_quoted": {"type": "string"},
                "objections": {
                    "type": "array",
                    "items": _obj(
                        {"objection": {"type": "string"}, "segment_id": {"type": "integer"}}
                    ),
                },
                "lost_reason": {"type": "string"},
            }
        ),
        "retention": _obj(
            {
                "outcome": _enum("saved", "cancelled", "pending", "not_applicable"),
                "cancel_reason": _enum(*CANCEL_REASONS),
                "root_cause": {"type": "string"},
                "offers_made": {"type": "array", "items": _enum(*SOLUTION_BANK)},
                "first_offer_accepted": {"type": "boolean"},
                "under_contract": _enum("yes", "no", "unknown"),
            }
        ),
        "service": _obj(
            {
                "request": {"type": "string"},
                "resolution": _enum("resolved", "partially", "unresolved", "not_applicable"),
                "actions_taken": {"type": "array", "items": {"type": "string"}},
            }
        ),
        "appointment": _obj({"booked": {"type": "boolean"}, "when": {"type": "string"}}),
        "follow_ups": {
            "type": "array",
            "items": _obj(
                {
                    "action": {"type": "string"},
                    "owner": _enum("rep", "office", "technician", "manager", "customer"),
                    "due": {"type": "string"},
                }
            ),
        },
        "customer_sentiment_end": _enum("positive", "neutral", "negative"),
    }
)

TRIAGE_SYSTEM = """You review recorded phone calls for a pest control company so the owner \
can see what happened on every call. You are precise and literal: you report only what is \
said in the transcript, and you say "" or "unknown" rather than guess.

The transcript is machine-generated from phone audio. Names, numbers and addresses may be \
misheard; words may be dropped. Each line is `[segment id] mm:ss SPEAKER: text`.

## Who is who
- The rep works for the pest control company and usually answers with a greeting like \
"<Company>, this is <name>". The customer is the caller (or the person the rep calls).
- An automated menu, hold message or voicemail greeting is role "other".
- Lines labelled SPEAKER chN come from separate recording channels, one person each: map \
every label in `speaker_roles` and leave `rep_segment_ids` empty.
- Otherwise (lines labelled VOICE x? or ?), the voice labels are unreliable hints from \
automatic separation of mono phone audio. Decide who spoke each line from its content and \
the turn-taking, and list in `rep_segment_ids` every segment the rep spoke. Leave \
`speaker_roles` empty.
- `rep_name` is the name the rep introduces themselves with (first name is fine), with the \
segment id where they say it. If they never say it, use "" and 0.

## Call types - pick the customer's primary reason for the call
- sales: someone who is not yet a customer asking about service, a quote, or signing up \
(also an existing customer buying an additional, separate service).
- retention: the customer wants to cancel, pause or stop service - at any point in the call. \
If cancel intent comes up at all, the call is retention.
- reservice: an existing customer reporting pests still present or a problem with a \
treatment, wanting someone to come back.
- scheduling: booking, moving or confirming a service appointment, with no pest problem as \
the main topic.
- billing: invoices, charges, balances, payment methods, declined cards.
- other_service: any other existing-customer request (address change, feedback about a \
technician, re-sending an invoice, general questions).
- not_scorable: no real two-way conversation with a customer - voicemail, wrong number, \
solicitor or vendor, internal staff call, or a call that ends before the rep can help. Set \
`not_scorable_reason` accordingly; for every other type it is "none".
`call_type_confidence` is 0-1: how clearly the transcript supports that type.

## Details
- `summary`: 2-3 plain sentences for the business owner: why they called, what happened, \
what happens next.
- `customer_wins`: what the customer values (wants, interests, needs) as short phrases, e.g. \
"pet-safe treatment", "fast appointment", "keep costs down".
- Fill the block that matches the call type - `sales` for sales, `retention` for \
retention, `service` for reservice, scheduling, billing and other_service calls (inbound or \
outbound). Set the other blocks' outcome/resolution to "not_applicable", strings to "" and \
lists to [].
- service.resolution: did the reason for the call get handled by the end? resolved / \
partially / unresolved.
- sales.outcome: sold = agreed to start service or booked the initial service; follow_up = \
interested but deciding / needs a callback; not_sold = declined.
- sales.objections: each concern the customer raised that stood between them and buying \
(price, "need to talk to my spouse", "shopping around", timing ...), with the segment id.
- retention.outcome: saved = agreed to stay (including accepting an offer or a hold); \
cancelled = the rep processed or agreed to the cancellation; pending = unresolved.
- `follow_ups`: concrete actions still owed after the call (callback, send quote, tech \
visit, manager review), who owns them, and when if stated."""

SCORING_SYSTEM = """You are a call coach for a pest control company. You grade the \
company's rep on one recorded call against the company's own scorecard, and you coach them \
the way their manager would in a weekly call review: specific, fair and encouraging.

## The company's call process
Every call follows four quadrants, with active listening at the centre:
1. Validation - validate the customer's specific situation with genuine empathy, build \
their confidence in you, and set expectations for what comes next.
2. Understand - investigate with open-ended questions (who, what, when, where, why, how) \
until you understand the root cause and at least 3 of the customer's WINs (wants, \
interests, needs); summarise them back and get agreement; set expectations.
3. Solve - present a solution tailored to their WINs (what, how, why), check for consensus, \
and close.
4. Verify - wrap up loose ends (date/time, details, notes), offer final information, and \
thank the customer genuinely.
Reps should affirm ("got it", "absolutely"), never interrupt, and ask follow-up questions \
that use what the customer already said.

## How to grade
- The standard for every item: would the rep's manager, reviewing this call against the \
scorecard, tick the box? Award it when the rep clearly performs the step's purpose, even \
briefly or imperfectly. Do not award it for a phrase that only resembles the step by \
accident, or for something the customer did instead of the rep. Where an item lists what \
counts and what does not, follow that exactly.
- Judge only the rep, and only on what the transcript shows. The transcript is \
machine-generated: ignore garbled words and never penalise transcription errors.
- Credit the behaviour, not the exact script wording. A functionally equivalent line counts.
- `met` needs evidence: at least one quote from the rep, copied word for word from the \
transcript, with the segment id it appears in. Keep quotes short (the key phrase).
- `missed` means the rep did not do it, or did it too vaguely to count. Say briefly what \
was missing. Evidence is optional; if you cite the moment it should have happened, quote \
that line accurately.
- `not_needed` is allowed ONLY on items whose description says when they are not needed. \
Never use it to skip an item.
- If the call ended early (customer hung up, dropped call), grade what happened and say so \
in the reason.

## Coaching
- `coaching`: the 2-3 changes that would most improve this call, highest impact first. \
Anchor each to a real moment (segment id), say what happened, and give the exact words the \
rep could have used - adapted from the company's scripts to this customer's situation. List \
the scorecard item keys it addresses.
- `strengths`: 1-2 things the rep genuinely did well, with the moment.
- `overall_feedback`: 2-3 sentences addressed to the rep ("you"), warm and direct.
- Never invent company policy, prices or offers that the scripts and call do not contain."""


def _scoring_schema(scorecard: Scorecard) -> dict[str, Any]:
    return _obj(
        {
            "items": {
                "type": "array",
                "description": f"Exactly one entry for each of the {scorecard.max_score} "
                "scorecard items.",
                "items": _obj(
                    {
                        "key": _enum(*[i.key for i in scorecard.items]),
                        "status": _enum("met", "missed", "not_needed"),
                        "reason": {"type": "string"},
                        "evidence": _EVIDENCE,
                    }
                ),
            },
            "strengths": {
                "type": "array",
                "items": _obj(
                    {
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                        "segment_id": {"type": "integer"},
                        "quote": {"type": "string"},
                    }
                ),
            },
            "coaching": {
                "type": "array",
                "items": _obj(
                    {
                        "title": {"type": "string"},
                        "item_keys": {
                            "type": "array",
                            "items": _enum(*[i.key for i in scorecard.items]),
                        },
                        "segment_id": {"type": "integer"},
                        "what_happened": {"type": "string"},
                        "try_saying": {"type": "string"},
                        "why_it_matters": {"type": "string"},
                    }
                ),
            },
            "overall_feedback": {"type": "string"},
        }
    )


def _scorecard_text(scorecard: Scorecard) -> str:
    lines = [f"## Scorecard: {scorecard.name} ({scorecard.max_score} items)"]
    quadrant = ""
    for item in scorecard.items:
        if item.quadrant != quadrant:
            quadrant = item.quadrant
            lines.append(f"\n### {quadrant}")
        lines.append(f"- `{item.key}` - {item.label}: {item.criteria}")
    if scorecard.notes:
        lines.append("\n### Notes")
        lines.extend(f"- {n}" for n in scorecard.notes)
    return "\n".join(lines)


# --- Result ------------------------------------------------------------------


@dataclass
class Analysis:
    call_type: str
    call_type_confidence: float
    lens: str | None
    outcome: str | None
    rep_name: str | None
    customer_name: str | None
    summary: str
    triage: dict[str, Any]
    scorecard_key: str | None = None
    score: int | None = None
    score_max: int | None = None
    grade: str | None = None
    items: list[dict[str, Any]] = field(default_factory=list)
    coaching: dict[str, Any] = field(default_factory=dict)
    evidence_verified_pct: float | None = None
    llm_results: list[LLMResult] = field(default_factory=list)

    @property
    def cost_usd(self) -> float:
        return round(sum(r.cost_usd for r in self.llm_results), 6)


class AnalysisFailed(RuntimeError):
    pass


# --- Passes ------------------------------------------------------------------


def assign_roles(segments: list[Segment], triage: dict[str, Any], *, diarized: bool) -> None:
    """Resolve speaker labels (or unlabeled segments) to rep/customer."""
    if diarized:
        roles = {}
        for entry in triage.get("speaker_roles") or []:
            role = entry.get("role")
            # The model may echo the label as rendered ("SPEAKER 0") or bare ("0").
            label = re.sub(r"(?i)^speaker\s*", "", str(entry.get("speaker", ""))).strip()
            roles[label] = REP if role == "rep" else CUSTOMER if role == "customer" else UNKNOWN
        apply_roles(segments, roles)
        return
    rep_ids = {int(i) for i in triage.get("rep_segment_ids") or [] if isinstance(i, int)}
    for s in segments:
        s.role = REP if s.id in rep_ids else CUSTOMER


def outcome_for(call_type: str, triage: dict[str, Any]) -> str | None:
    lens = rubrics.LENS_BY_CALL_TYPE.get(call_type)
    if lens == "sales":
        return (triage.get("sales") or {}).get("outcome")
    if lens == "retention":
        return (triage.get("retention") or {}).get("outcome")
    if lens == "service":
        return (triage.get("service") or {}).get("resolution")
    return None


def apply_manual_rules(
    call_type: str, judgements: dict[str, dict[str, Any]], triage: dict[str, Any]
) -> None:
    """Enforce the scorecard notes the model must not decide on its own."""
    if call_type == CallType.SALES:
        objections = (triage.get("sales") or {}).get("objections") or []
        keys = ("objection_agree", "objection_restate", "objection_resolve",
                "objection_reclose")
        for key in keys:
            j = judgements.setdefault(key, {})
            if not objections:
                # "On sales calls where the customer doesn't give any objections
                # ... the Sales Rep automatically gets 4 points."
                j["status"] = "not_needed"
                j["agreement"] = "rule"
                j["reason"] = "No objections were raised, so this point is awarded automatically."
            elif j.get("status") == "not_needed":
                j["status"] = "missed"
    if call_type == CallType.RETENTION:
        retention = triage.get("retention") or {}
        j = judgements.setdefault("repeat", {})
        exempt = retention.get("first_offer_accepted") or retention.get("cancel_reason") in (
            "moving", "deceased"
        )
        if exempt and j.get("status") != "met":
            j["status"] = "not_needed"
            j["agreement"] = "rule"
        elif not exempt and j.get("status") == "not_needed":
            j["status"] = "missed"


async def analyse(segments: list[Segment], *, diarized: bool) -> Analysis:
    llm = get_llm()

    triage, triage_llm = await llm.analyse_json(
        TRIAGE_SYSTEM,
        "Transcript:\n\n" + render(segments, by_role=False),
        TRIAGE_SCHEMA,
        effort="high",
    )
    if not triage or "call_type" not in triage:
        raise AnalysisFailed("call classification returned no result")

    assign_roles(segments, triage, diarized=diarized)
    if not any(s.role == REP for s in segments):
        raise AnalysisFailed("could not tell which speaker is the rep")

    call_type = str(triage["call_type"])
    rep_name = (triage.get("rep_name") or "").strip() or None
    analysis = Analysis(
        call_type=call_type,
        call_type_confidence=max(0.0, min(1.0, float(triage.get("call_type_confidence") or 0))),
        lens=rubrics.LENS_BY_CALL_TYPE.get(call_type),
        outcome=outcome_for(call_type, triage),
        rep_name=rep_name,
        customer_name=(triage.get("customer_name") or "").strip() or None,
        summary=str(triage.get("summary") or "").strip(),
        triage=triage,
        llm_results=[triage_llm],
    )

    scorecard = rubrics.scorecard_for(call_type)
    if scorecard is None:
        return analysis

    context = _call_context(call_type, triage)
    runs = max(1, get_settings().intel_scoring_runs)
    outcomes = await asyncio.gather(
        *(
            llm.analyse_json(
                SCORING_SYSTEM + "\n\n" + _scorecard_text(scorecard),
                f"{context}\n\nTranscript:\n\n{render(segments, by_role=True)}",
                _scoring_schema(scorecard),
                effort="high",
            )
            for _ in range(runs)
        ),
        return_exceptions=True,
    )
    scorings: list[dict[str, Any]] = []
    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            log.warning("intel.scoring_run_failed", error=str(outcome))
            continue
        scored_run, run_llm = outcome
        analysis.llm_results.append(run_llm)
        if scored_run and scored_run.get("items"):
            scorings.append(scored_run)
    # A majority needs more than half the requested runs to have answered.
    if len(scorings) * 2 <= runs:
        raise AnalysisFailed(f"scoring returned {len(scorings)} of {runs} results")

    judgements, scored = consensus(scorings)
    apply_manual_rules(call_type, judgements, triage)
    items, score = rubrics.tally(scorecard, judgements)

    verified = total = 0
    item_rows = []
    for item in items:
        evidence = resolve_evidence(item.evidence, segments)
        if item.status == "met":
            # A point with no quote at all counts as one unverified citation.
            total += max(1, len(evidence))
            verified += sum(1 for e in evidence if e["verified"])
        item_rows.append(
            {
                "key": item.key,
                "label": item.label,
                "quadrant": item.quadrant,
                "status": item.status,
                "awarded": item.awarded,
                "auto_awarded": item.auto_awarded,
                "reason": item.reason,
                "evidence": evidence,
                "agreement": judgements.get(item.key, {}).get("agreement"),
            }
        )

    analysis.scorecard_key = scorecard.key
    analysis.score = score
    analysis.score_max = scorecard.max_score
    analysis.grade = scorecard.grade(score).value
    analysis.items = item_rows
    analysis.evidence_verified_pct = round(verified / total * 100, 1) if total else None
    analysis.coaching = {
        "overall_feedback": str(scored.get("overall_feedback") or "").strip(),
        "strengths": [_moment(s, segments) for s in scored.get("strengths") or []],
        "coaching": [_moment(c, segments) for c in scored.get("coaching") or []],
    }
    return analysis


def consensus(
    scorings: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Majority verdict per item across independent scoring runs.

    One run can tip a borderline item either way; the majority is stable. Each
    item records how many runs agreed, so a split decision is shown as
    borderline rather than presented as certain. Ties go to "missed" - a point
    has to be earned. Reasons, evidence and coaching come from the run that
    agrees with the majority most often, so they explain the grade shown.
    """
    per_run = [
        {str(j.get("key")): dict(j) for j in run.get("items") or []} for run in scorings
    ]
    keys = list(dict.fromkeys(k for run in per_run for k in run))
    verdicts: dict[str, str] = {}
    agreement: dict[str, str] = {}
    for key in keys:
        votes = [run[key].get("status", "missed") for run in per_run if key in run]
        counts = {status: votes.count(status) for status in set(votes)}
        top = max(counts.values())
        leaders = [status for status, n in counts.items() if n == top]
        verdicts[key] = leaders[0] if len(leaders) == 1 else "missed"
        agreement[key] = f"{counts.get(verdicts[key], 0)}/{len(per_run)}"

    def matches(run: dict[str, dict[str, Any]]) -> int:
        return sum(1 for k, v in verdicts.items() if run.get(k, {}).get("status") == v)

    best = max(range(len(per_run)), key=lambda i: matches(per_run[i]))
    judgements: dict[str, dict[str, Any]] = {}
    for key, status in verdicts.items():
        source = per_run[best].get(key)
        if source is None or source.get("status") != status:
            # The representative run disagrees here; explain the majority view.
            source = next(run[key] for run in per_run if run.get(key, {}).get("status") == status)
        judgements[key] = {**source, "status": status, "agreement": agreement[key]}
    return judgements, scorings[best]


def _call_context(call_type: str, triage: dict[str, Any]) -> str:
    label = rubrics.CALL_TYPE_LABELS.get(call_type, call_type)
    lines = [f"Call type: {label}.", f"Summary: {triage.get('summary', '')}"]
    if call_type == CallType.SALES:
        objections = (triage.get("sales") or {}).get("objections") or []
        lines.append(
            "Objections raised: "
            + ("; ".join(o.get("objection", "") for o in objections) if objections else "none")
        )
    if call_type == CallType.RETENTION:
        r = triage.get("retention") or {}
        lines.append(
            f"Cancel reason: {r.get('cancel_reason')}; first offer accepted: "
            f"{r.get('first_offer_accepted')}; outcome: {r.get('outcome')}."
        )
    return "\n".join(lines)


def _moment(entry: dict[str, Any], segments: list[Segment]) -> dict[str, Any]:
    """Attach the timestamp of the cited segment to a coaching/strength entry."""
    out = dict(entry)
    by_id = {s.id: s for s in segments}
    seg = by_id.get(int(entry.get("segment_id") or 0))
    out["start"] = round(seg.start, 2) if seg else None
    if entry.get("quote"):
        ev = resolve_evidence([{"segment_id": entry.get("segment_id"),
                                "quote": entry["quote"]}], segments)
        out["verified"] = ev[0]["verified"] if ev else False
    return out
