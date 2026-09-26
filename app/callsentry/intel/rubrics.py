"""PestLaunch call scorecards, encoded from the office and sales call manuals.

Scorecards are binary checklists: each item is met or missed, and the grade is
a fixed threshold on the total. The model judges individual items against the
criteria below; the total, the grade, and every automatic award are computed
here so the same evidence always produces the same grade.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class CallType(StrEnum):
    SALES = "sales"
    RETENTION = "retention"
    RESERVICE = "reservice"
    SCHEDULING = "scheduling"
    BILLING = "billing"
    OTHER_SERVICE = "other_service"
    NOT_SCORABLE = "not_scorable"


CALL_TYPE_LABELS: dict[str, str] = {
    CallType.SALES: "Sales",
    CallType.RETENTION: "Retention",
    CallType.RESERVICE: "Re-service",
    CallType.SCHEDULING: "Scheduling",
    CallType.BILLING: "Billing",
    CallType.OTHER_SERVICE: "Customer service",
    CallType.NOT_SCORABLE: "Not scored",
}

# How the owner reads the business: three lenses over the call types.
LENS_BY_CALL_TYPE: dict[str, str] = {
    CallType.SALES: "sales",
    CallType.RETENTION: "retention",
    CallType.RESERVICE: "service",
    CallType.SCHEDULING: "service",
    CallType.BILLING: "service",
    CallType.OTHER_SERVICE: "service",
}


class Grade(StrEnum):
    GOLD = "gold"
    GREEN = "green"
    BELOW = "below"


@dataclass(frozen=True)
class Item:
    key: str
    label: str
    quadrant: str
    criteria: str
    # Items the manual awards automatically when the situation never arose
    # (no objections on a sales call, first retention offer accepted).
    auto_award_when_not_needed: bool = False


@dataclass(frozen=True)
class Scorecard:
    key: str
    name: str
    items: tuple[Item, ...]
    gold_at: int
    green_at: int
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def max_score(self) -> int:
        return len(self.items)

    def item(self, key: str) -> Item | None:
        return next((i for i in self.items if i.key == key), None)

    def grade(self, score: int) -> Grade:
        if score >= self.gold_at:
            return Grade.GOLD
        if score >= self.green_at:
            return Grade.GREEN
        return Grade.BELOW


# --- Shared item definitions -------------------------------------------------

_VALIDATE = Item(
    "validate",
    "Validate",
    "Validation",
    "Early in the call the rep validates the customer's specific reason for calling with "
    "genuine empathy that names the actual situation (e.g. 'so sorry about the ants in "
    "your kitchen'). A generic 'sure, I can help' with no reference to their situation "
    "does not count. On simple scheduling/billing calls a warm, specific acknowledgement "
    "of the request counts.",
)
_CONFIDENCE = Item(
    "confidence_statement",
    "Confidence Statement",
    "Validation",
    "The rep clearly tells the customer they will take care of it / are on their team "
    "(e.g. 'I can definitely take care of this for you').",
)
_EXPECTATION_1 = Item(
    "expectation_statement_1",
    "Expectation Statement",
    "Validation",
    "Before investigating, the rep tells the customer what is about to happen "
    "(e.g. 'I'm just going to ask you a few questions about that so ...' or "
    "'let me pull up your account and double check the schedule').",
)
_INVESTIGATE = Item(
    "investigate",
    "Investigate",
    "Understand",
    "The rep asks questions, primarily open-ended (who/what/when/where/why/how), to "
    "understand the situation and root cause before offering a solution. Purely "
    "transactional data collection (name, address) alone does not count.",
)
_SUMMARY = Item(
    "summary_statement",
    "Summary Statement",
    "Understand",
    "The rep restates what they learned back to the customer - their situation and what "
    "matters to them (their WINs: wants, interests, needs) - and gets agreement "
    "(e.g. 'so it sounds like you want something thorough that's pet-friendly, right?').",
)
_EXPECTATION_2 = Item(
    "expectation_statement_2",
    "Expectation Statement",
    "Understand",
    "Before presenting the solution, the rep tells the customer what comes next "
    "(e.g. 'I'm going to walk you through our service, then we'll talk price').",
)
_PRESENT = Item(
    "present_solution",
    "Present Solution",
    "Solve",
    "The rep presents a clear solution tailored to this customer, ideally explaining what "
    "will be done, how, and why it matters for their situation, in order.",
)
_CONSENSUS = Item(
    "consensus",
    "Consensus",
    "Solve",
    "The rep checks that the customer agrees or has no questions about the solution "
    "(e.g. 'does that make sense?', 'any questions before we talk price?', "
    "'how does that sound?').",
)
_CLOSE = Item(
    "close",
    "Close",
    "Solve",
    "The rep moves the customer to commit: books/schedules, confirms the change, or asks "
    "an option close ('morning or afternoon?'). On calls with no cost, securing the "
    "agreed next step is the close.",
)
_CONCLUSION = Item(
    "provide_conclusion",
    "Provide a Conclusion",
    "Verify",
    "The rep wraps up loose ends and sets expectations for what happens next: confirms "
    "details such as date/time, name, address, email, notes for the tech, pets, gate codes. "
    "Does not count: only 'you're all set' with no detail.",
)
_THANK = Item(
    "thank_customer",
    "Thank the Customer",
    "Verify",
    "The rep genuinely thanks the customer near the end of the call (a sincere thank-you "
    "for calling / for their business). Does not count: only a reflexive 'thanks, bye' or "
    "'have a good one', or thanks said only by the customer.",
)
_FINAL_INFO = Item(
    "final_information",
    "Offer Final Information",
    "Verify",
    "The rep offers useful final information: call us first for any other pest needs "
    "(one-stop shop), what to expect after service, or how to reach the office.",
)

ALL_CALLS = Scorecard(
    key="all_calls",
    name="Call Process Scorecard",
    items=(
        _VALIDATE,
        _CONFIDENCE,
        _EXPECTATION_1,
        _INVESTIGATE,
        _SUMMARY,
        _EXPECTATION_2,
        _PRESENT,
        _CONSENSUS,
        _CLOSE,
        _CONCLUSION,
        _THANK,
        _FINAL_INFO,
    ),
    gold_at=12,
    green_at=11,
    notes=(
        "Used for re-service, scheduling, billing, and other customer service calls.",
        "On scheduling/billing calls the Understand quadrant is often brief; a short, "
        "relevant clarifying question and a quick restatement are enough to meet it.",
    ),
)

RETENTION = Scorecard(
    key="retention",
    name="Retention Call Scorecard",
    items=(
        Item(
            "validate_confidence",
            "Validate & Confidence Statement",
            "Validation",
            "The rep acknowledges the request calmly and assures the customer they will be "
            "taken care of - WITHOUT agreeing to cancel (saying 'yes, I can cancel that for "
            "you' up front is a miss).",
        ),
        Item(
            "transition_statement",
            "Transition Statement",
            "Validation",
            "The rep transitions into looking at the account (e.g. 'what's the address on "
            "the account? ... let me take a quick look here'). Counts: asking for the "
            "address/account in order to pull it up, or saying they'll take a look. Does not "
            "count: going straight from the cancel request to processing it.",
        ),
        Item(
            "do_research",
            "Do Your Research",
            "Validation",
            "The rep references account history: tenure, contract status, recent services, "
            "re-services or past issues - showing they looked before responding.",
        ),
        Item(
            "investigate",
            "Investigate",
            "Understand",
            "The rep asks open-ended questions to find the real reason for cancelling, "
            "without interrogating or asking too many questions.",
        ),
        Item(
            "validate_summary",
            "Validate & Summary Statement",
            "Understand",
            "The rep validates again and restates the reason in their own words to confirm "
            "it (e.g. 'so the service has been good, you're just looking for a cheaper "
            "option right now?').",
        ),
        Item(
            "validate_expectation",
            "Validate & Expectation Statement",
            "Understand",
            "The rep stays on the customer's side and primes them for options "
            "(e.g. 'I want to make this right - let me give you a couple of options').",
        ),
        Item(
            "present_solution",
            "Present Solution",
            "Solve",
            "The rep offers a specific save tailored to the root cause, from the solution "
            "bank: free re-service, back-to-back services, custom plan, waived month(s), set "
            "day/time/technician, account hold, service or branch manager visit, or a 10% "
            "price drop (price-only reasons). Offering nothing is a miss.",
        ),
        Item(
            "consensus",
            "Consensus",
            "Solve",
            "The rep asks for buy-in on the offer (e.g. 'does that work for you?').",
        ),
        Item(
            "repeat",
            "Repeat (when necessary)",
            "Solve",
            "If the first offer was declined, the rep asks more questions and offers a new "
            "or additional solution before accepting the cancellation (and raises contract "
            "terms only after solutions fail). Not needed if the first offer was accepted "
            "or the customer is moving out of the area / deceased.",
            auto_award_when_not_needed=True,
        ),
        Item(
            "provide_conclusion",
            "Provide a Conclusion",
            "Verify",
            "The rep wraps up and sets clear expectations for what happens next, whether "
            "saved or cancelled. Counts: confirming what was done and at least one concrete "
            "next step or detail (effective date, no further charges, next service date, "
            "confirmation email). Does not count: only 'you're all set'.",
        ),
        Item(
            "thank_customer",
            "Thank the Customer",
            "Verify",
            "The rep genuinely thanks the customer (for calling, for their business, for "
            "being a customer). Does not count: only 'have a good one' / 'bye', or thanks "
            "said only by the customer.",
        ),
        Item(
            "leave_teaser",
            "Leave a Teaser",
            "Verify",
            "The rep ends on a positive note with an incentive or open door to come back "
            "(e.g. a free initial service if they return). Counts: an explicit invitation to "
            "restart service later (an incentive is best practice, not required). On a saved "
            "account, a positive forward-looking close counts. Does not count: a generic "
            "'call us if you need anything' with no mention of coming back.",
        ),
    ),
    gold_at=12,
    green_at=11,
    notes=(
        "Objective order: the customer's experience first, the save second.",
        "Moving out of the service area or a deceased customer: proceed with the "
        "cancellation - the save steps are not expected.",
    ),
)

SALES = Scorecard(
    key="sales",
    name="Sales Call Scorecard",
    items=(
        _VALIDATE,
        _CONFIDENCE,
        _EXPECTATION_1,
        _INVESTIGATE,
        Item(
            "summary_statement",
            "Summary Statement",
            "Understand",
            "The rep restates at least some of the customer's WINs (wants, interests, needs "
            "- e.g. affordable, thorough, pet-friendly) and gets agreement.",
        ),
        Item(
            "expectation_statement_2",
            "Expectation Statement",
            "Understand",
            "The rep says they'll walk through the service, then price, then scheduling.",
        ),
        Item(
            "present_solution",
            "Present Solution",
            "Solve",
            "The rep explains the service in order - what, how, and why - tailored to the "
            "customer's pests and home (e.g. foundation, yard, eaves, interior), building "
            "value before price.",
        ),
        _CONSENSUS,
        Item(
            "close",
            "Close",
            "Solve",
            "The rep asks for the sale with an assumptive or option close "
            "(e.g. 'morning or afternoon?').",
        ),
        Item(
            "pricing",
            "Pricing",
            "Pricing",
            "The rep presents price clearly, ideally anchor price first then the sale price "
            "and recurring price, after building value.",
        ),
        Item(
            "objection_agree",
            "Agree",
            "Overcome Objections",
            "When an objection comes up, the rep first agrees / sides with the customer's "
            "point of view without debating.",
            auto_award_when_not_needed=True,
        ),
        Item(
            "objection_restate",
            "Restate & Insinuate",
            "Overcome Objections",
            "The rep restates the objection in their own words and suggests a possible "
            "underlying reason to isolate the real concern.",
            auto_award_when_not_needed=True,
        ),
        Item(
            "objection_resolve",
            "Resolve",
            "Overcome Objections",
            "The rep addresses the concern with a solution and builds more value.",
            auto_award_when_not_needed=True,
        ),
        Item(
            "objection_reclose",
            "Re-Close",
            "Overcome Objections",
            "The rep confidently asks for the sale again after resolving the objection.",
            auto_award_when_not_needed=True,
        ),
        _CONCLUSION,
        Item(
            "final_information",
            "Offer Final Information",
            "Verify",
            "The rep mentions the one-stop shop for all pest needs and/or the referral "
            "program.",
        ),
        _THANK,
    ),
    gold_at=17,
    green_at=14,
    notes=(
        "If the customer raised no objections, the four objection items are awarded "
        "automatically.",
        "Inspection-first sales (commercial accounts, termites, wildlife and other jobs the "
        "company only quotes after an inspection): explaining clearly what the inspection "
        "involves and why meets Present Solution, and explaining how and when the price "
        "will be given meets Pricing.",
    ),
)

SCORECARDS: dict[str, Scorecard] = {s.key: s for s in (ALL_CALLS, RETENTION, SALES)}

SCORECARD_BY_CALL_TYPE: dict[str, Scorecard] = {
    CallType.SALES: SALES,
    CallType.RETENTION: RETENTION,
    CallType.RESERVICE: ALL_CALLS,
    CallType.SCHEDULING: ALL_CALLS,
    CallType.BILLING: ALL_CALLS,
    CallType.OTHER_SERVICE: ALL_CALLS,
}


def scorecard_for(call_type: str) -> Scorecard | None:
    """The scorecard a call type is graded on, or None when it is not graded."""
    return SCORECARD_BY_CALL_TYPE.get(call_type)


class ItemStatus(StrEnum):
    MET = "met"
    MISSED = "missed"
    NOT_NEEDED = "not_needed"


@dataclass
class ScoredItem:
    key: str
    label: str
    quadrant: str
    status: str
    awarded: bool
    auto_awarded: bool
    reason: str
    evidence: list[dict[str, object]]


def tally(
    scorecard: Scorecard, judgements: dict[str, dict[str, object]]
) -> tuple[list[ScoredItem], int]:
    """Turn per-item judgements into awarded points.

    `not_needed` earns the point only on items the manual auto-awards. Anywhere
    else it is treated as a miss - an item the model skipped is never a free
    point. A missing judgement is likewise a miss.
    """
    scored: list[ScoredItem] = []
    for item in scorecard.items:
        raw = judgements.get(item.key) or {}
        status = str(raw.get("status") or ItemStatus.MISSED)
        if status not in {s.value for s in ItemStatus}:
            status = ItemStatus.MISSED
        auto = status == ItemStatus.NOT_NEEDED and item.auto_award_when_not_needed
        if status == ItemStatus.NOT_NEEDED and not item.auto_award_when_not_needed:
            status = ItemStatus.MISSED
        awarded = status == ItemStatus.MET or auto
        evidence = raw.get("evidence")
        scored.append(
            ScoredItem(
                key=item.key,
                label=item.label,
                quadrant=item.quadrant,
                status=status,
                awarded=awarded,
                auto_awarded=auto,
                reason=str(raw.get("reason") or ""),
                evidence=list(evidence) if isinstance(evidence, list) else [],
            )
        )
    return scored, sum(1 for s in scored if s.awarded)
