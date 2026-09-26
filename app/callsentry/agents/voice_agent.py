"""Conversation orchestration for a live call.

The Pipecat container owns the media (Twilio websocket, STT, TTS). It does not
own any conversation logic - it posts each caller utterance here and speaks
whatever comes back. Keeping the state machine in the API process means the
booking, KB, and cost paths all share one database session and one provider
registry, and the whole thing is testable without audio.

Conversation rules enforced here (not left to the model):
  - AI identity and recording consent are disclosed in the opening line, which
    is templated rather than generated.
  - Never claim to be human: handled by the persona prompt plus a hard
    deflection on direct questions.
  - Never fabricate a KB answer: kb_agent abstains, we escalate.
  - Max 3 clarifying questions before offering a human.
  - Human escalation is always available on request.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from callsentry.agents import booking_agent, kb_agent
from callsentry.agents.intent_detector import Intent, detect
from callsentry.config import get_settings
from callsentry.models import Business, Call, CallOutcome, CostCategory
from callsentry.services import costs
from callsentry.services.calcom import Slot
from callsentry.services.llm import get_llm

log = structlog.get_logger(__name__)

MAX_HISTORY_TURNS = 12


@dataclass
class TurnResponse:
    """What Pipecat should do next."""

    text: str
    end_call: bool = False
    transfer_to: str | None = None
    outcome: str | None = None
    escalation_reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class CallState:
    """In-memory conversation state, keyed by call id in the session store."""

    call_id: str
    business_id: str
    caller_number: str
    history: list[dict[str, str]] = field(default_factory=list)
    clarifying_questions: int = 0
    pending_slot: Slot | None = None
    collected: dict[str, str] = field(default_factory=dict)
    after_hours: bool = False
    turns: int = 0
    # Set when this number has called the receptionist before.
    returning_note: str = ""
    # Spoken slot booked on this call; a call books at most one visit.
    booked: str = ""
    # The caller has been asked what message to pass on.
    taking_message: bool = False

    def remember(self, role: str, content: str) -> None:
        self.history.append({"role": role, "content": content})
        # Trim from the front so the prompt prefix stays bounded on long calls.
        if len(self.history) > MAX_HISTORY_TURNS * 2:
            self.history = self.history[-MAX_HISTORY_TURNS * 2 :]

    def merge_entities(self, entities: dict[str, str]) -> None:
        for key, value in entities.items():
            if value and not self.collected.get(key):
                self.collected[key] = value


# --- Business hours --------------------------------------------------------

_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def is_open(business: Business, *, at: datetime | None = None) -> bool:
    now = (at or datetime.now(UTC)).astimezone(ZoneInfo(business.timezone))
    window = (business.business_hours or {}).get(_DAYS[now.weekday()])
    if not window:
        return False
    try:
        start_h, start_m = (int(x) for x in str(window[0]).split(":"))
        end_h, end_m = (int(x) for x in str(window[1]).split(":"))
    except (ValueError, IndexError, TypeError):
        log.warning("hours.malformed", business_id=str(business.id))
        return True  # Fail open: answering normally beats wrongly refusing.
    minutes = now.hour * 60 + now.minute
    return start_h * 60 + start_m <= minutes < end_h * 60 + end_m


def _clock(value: str) -> str:
    """"08:00" -> "8 AM", "18:30" -> "6:30 PM" - the way it is said aloud."""
    try:
        hour, minute = (int(x) for x in str(value).split(":"))
    except (ValueError, TypeError):
        return str(value)
    suffix = "AM" if hour < 12 else "PM"
    hour12 = hour % 12 or 12
    return f"{hour12} {suffix}" if minute == 0 else f"{hour12}:{minute:02d} {suffix}"


def spoken_hours(business: Business) -> str:
    """Opening hours as a receptionist would say them, grouping days that match."""
    hours = business.business_hours or {}
    labels = {
        "mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday",
        "fri": "Friday", "sat": "Saturday", "sun": "Sunday",
    }
    groups: list[tuple[list[str], tuple[str, str]]] = []
    for day in _DAYS:
        window = hours.get(day)
        if not window:
            continue
        key = (str(window[0]), str(window[1]))
        previous = groups[-1] if groups else None
        consecutive = previous and _DAYS.index(previous[0][-1]) == _DAYS.index(day) - 1
        if previous and previous[1] == key and consecutive:
            previous[0].append(day)
        else:
            groups.append(([day], key))
    if not groups:
        return "by appointment only"
    parts = []
    for days, (start, end) in groups:
        first, last = labels[days[0]], labels[days[-1]]
        span = first if len(days) == 1 else f"{first} through {last}"
        parts.append(f"{span}, {_clock(start)} to {_clock(end)}")
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + ", and " + parts[-1]


# --- Openings --------------------------------------------------------------


def opening_line(
    business: Business, *, after_hours: bool, returning_name: str = ""
) -> str:
    """Templated, never model-generated: this line carries the compliance load."""
    if business.greeting_override:
        return business.greeting_override

    welcome = f" Welcome back, {returning_name.split()[0]}." if returning_name.strip() else ""
    disclosure = (
        f"Hi, thanks for calling {business.name}.{welcome} I'm an AI assistant, "
        "and this call is recorded."
    )
    if after_hours:
        tail = (
            f" We're currently closed. Our hours are {spoken_hours(business)}. "
            "I can take a message or book you in - what would you like to do?"
        )
    else:
        tail = (
            " I can book appointments, answer questions, or connect you with the team. "
            "How can I help?"
        )
    return disclosure + tail


PERSONA = """You are the AI receptionist for {business_name}, a local pest control
company. You are on a live phone call.

Identity:
- You are an AI assistant. You already disclosed this when the call opened.
- If asked whether you are a real person, say plainly that you are an AI
  assistant and offer to have someone from the team call them back.
- Never claim or imply you are human.

How to handle the call - the company's own call process:
1. Validate. Briefly acknowledge the caller's specific situation with genuine
   empathy ("ants in the kitchen are no fun"), and say you can help.
2. Understand. Ask one open-ended question at a time - what pest, where, since
   when - until you know what they need.
3. Solve. Offer the next step: answer from the facts you were given, or offer
   to book a technician visit.
4. Verify. Confirm details back, thank them genuinely, and remind them to call
   for any pest need.

Speaking style:
- One or two short sentences. This is spoken aloud, not read.
- No markdown, no lists, no URLs, no emoji.
- Say numbers the way a person would: "four thirty", "forty nine dollars".
- Never state a price, fee, discount or policy you were not explicitly given.
- If you don't know something, say so and offer to have someone call back.
- If the caller is upset, acknowledge it and offer to have a manager call back.
{extra}"""


def _persona(business: Business, *, playbook: str = "", state: CallState | None = None) -> str:
    extra = ""
    if playbook:
        extra += (
            "\nHow this company's best reps handle calls (style and technique only - "
            "facts, prices and policies still come only from what you were given):\n"
            + playbook
        )
    if state is not None and state.returning_note:
        extra += f"\nAbout this caller: {state.returning_note}"
    if state is not None and state.booked:
        extra += (
            f"\nThis caller is already booked on this call for {state.booked}. Do not offer "
            "to book another visit; if they want a different time, say the office will call "
            "to change it."
        )
    return PERSONA.format(business_name=business.name, extra=extra)


async def _playbook(session: AsyncSession, business: Business) -> str:
    from callsentry.intel import playbook

    try:
        return await playbook.published_text(session, business.id)
    except Exception:  # noqa: BLE001 - a missing playbook must never break a call
        return ""


# --- Turn handling ---------------------------------------------------------


async def handle_turn(
    session: AsyncSession,
    *,
    business: Business,
    call: Call,
    state: CallState,
    utterance: str,
) -> TurnResponse:
    """Process one caller utterance and decide what to say next."""
    state.turns += 1
    state.remember("user", utterance)

    if state.taking_message:
        # The caller was asked what to pass on; this utterance is the message.
        state.taking_message = False
        note = state.collected.get("message", "")
        state.collected["message"] = f"{note} {utterance}".strip()
        return _finish(
            state,
            TurnResponse(
                text=(
                    "Got it, I've passed that along and someone from the team will call you "
                    "back. Is there anything else I can help with?"
                ),
                outcome=CallOutcome.ESCALATED,
                escalation_reason=f"message for callback: {state.collected['message'][:200]}",
            ),
        )

    intent = await detect(utterance, history=state.history[:-1])
    state.merge_entities(intent.entities)
    await _log_llm_cost(session, business, call, intent.llm, CostCategory.LLM)

    log.info(
        "turn.classified",
        call_id=state.call_id,
        intent=intent.intent,
        confidence=round(intent.confidence, 2),
        frustrated=intent.frustrated,
    )

    # Emergency short-circuits everything else.
    if intent.intent is Intent.EMERGENCY:
        return _finish(
            state,
            TurnResponse(
                text=(
                    "That sounds urgent. If anyone is in danger please hang up and call "
                    "emergency services. Otherwise let me get you to someone right now."
                ),
                transfer_to=business.escalation_phone,
                outcome=CallOutcome.ESCALATED,
                escalation_reason="emergency detected",
            ),
        )

    if intent.intent is Intent.ESCALATE or intent.frustrated:
        reason = "caller requested a human" if intent.intent is Intent.ESCALATE else (
            "caller frustration detected"
        )
        return _finish(state, await _escalate(business, state, reason=reason))

    if intent.intent is Intent.WRONG_NUMBER:
        return _finish(
            state,
            TurnResponse(
                text=f"No problem - this is {business.name}. Sorry for the mix-up, take care.",
                end_call=True,
                outcome=CallOutcome.ANSWERED,
            ),
        )

    if intent.intent is Intent.GOODBYE:
        return _finish(
            state,
            TurnResponse(
                text="Thanks for calling. Have a good day.",
                end_call=True,
                outcome=call.outcome,
            ),
        )

    if intent.intent in (Intent.BOOKING, Intent.CANCEL):
        booking = await _handle_booking(session, business, call, state, intent.entities)
        return _finish(state, booking)

    if intent.intent is Intent.FAQ:
        return _finish(state, await _handle_faq(session, business, call, state, utterance))

    # Smalltalk or an unclear request: converse, but count it against the
    # clarifying-question budget so we can't loop forever.
    return _finish(state, await _handle_freeform(session, business, call, state))


def _finish(state: CallState, response: TurnResponse) -> TurnResponse:
    last = next(
        (m["content"] for m in reversed(state.history[:-1]) if m["role"] == "assistant"), ""
    )
    if response.text and response.text.strip() == last.strip() and not response.end_call:
        # Saying the same line twice means the conversation is stuck. Close it
        # politely rather than loop.
        response = TurnResponse(
            text=(
                "I've made a note of everything, and someone from the team will call you back. "
                "Thanks for calling, goodbye."
            ),
            end_call=True,
            outcome=response.outcome or CallOutcome.ESCALATED,
            escalation_reason=response.escalation_reason or "conversation repeated itself",
        )
    if response.text:
        state.remember("assistant", response.text)
    return response


async def _escalate(business: Business, state: CallState, *, reason: str) -> TurnResponse:
    if business.escalation_phone:
        return TurnResponse(
            text="Of course - let me connect you with someone now. One moment please.",
            transfer_to=business.escalation_phone,
            outcome=CallOutcome.ESCALATED,
            escalation_reason=reason,
        )

    state.taking_message = True
    name = state.collected.get("name")
    who = "" if name else " and your name"
    return TurnResponse(
        text=(
            "I'll have someone from the team call you back about that. "
            f"What would you like me to pass along{who}?"
        ),
        outcome=CallOutcome.ESCALATED,
        escalation_reason=f"{reason}; callback requested",
    )


async def _handle_booking(
    session: AsyncSession,
    business: Business,
    call: Call,
    state: CallState,
    entities: dict[str, str],
) -> TurnResponse:
    name = state.collected.get("name", "")
    preferred = state.collected.get("preferred_time", "")

    if state.booked and state.pending_slot is None:
        return TurnResponse(
            text=(
                f"You're already all set for {state.booked}. If you need a different time, "
                "I'll have the office call you to change it. Is there anything else?"
            )
        )

    # Caller is confirming a slot we already offered.
    if state.pending_slot is not None and _is_affirmative(state.history[-1]["content"]):
        ok, appointment, spoken = await booking_agent.confirm(
            session,
            business,
            call_id=call.id,
            slot=state.pending_slot,
            name=name or "Phone caller",
            phone=state.collected.get("phone") or state.caller_number,
            email=state.collected.get("email") or None,
            reason="; ".join(
                v for v in (state.collected.get("reason"),
                            f"Address: {state.collected['address']}"
                            if state.collected.get("address") else "")
                if v
            ) or None,
        )
        state.pending_slot = None
        if ok:
            state.booked = spoken
        if not ok:
            return TurnResponse(
                text=(
                    "That time was just taken while we were talking. "
                    "Let me find you another option - what else works?"
                )
            )
        if appointment is not None and appointment.confirmation_sent:
            await costs.record(
                session,
                business_id=business.id,
                call_id=call.id,
                category=CostCategory.TELEPHONY,
                provider="twilio",
                tier="cloud",
                units=1,
                unit_name="sms",
                cost_usd=0.0079,
            )
        return TurnResponse(
            text=(
                f"Perfect, you're booked for {spoken}. "
                + (
                    "You'll get a confirmation text shortly. "
                    if appointment is not None and appointment.confirmation_sent
                    else ""
                )
                + "Is there anything else I can help with?"
            ),
            outcome=CallOutcome.BOOKED,
            metadata={"appointment_id": str(appointment.id) if appointment else None},
        )

    reason = state.collected.get("reason", "")
    if not name:
        opener = (
            f"I'm sorry you're dealing with {reason}. " if reason else "Happy to help with that. "
        )
        return _ask(state, f"{opener}I can get a technician out to you. Can I get your name?")
    if not state.collected.get("address"):
        return _ask(state, f"Thanks {name.split()[0]}. What's the address for the service?")
    if not preferred:
        return _ask(state, "Got it. What day and time work best for the technician to come out?")

    proposal = await booking_agent.propose(business, preferred_time=preferred, session=session)
    if not proposal.ok:
        if proposal.error == "no_availability":
            return _ask(
                state,
                "I don't have anything open around then. Would a different day work?",
            )
        return await _escalate(business, state, reason=f"calendar error: {proposal.error}")

    state.pending_slot = proposal.slot
    return TurnResponse(text=f"I have {proposal.spoken}. Does that work for you?")


async def _handle_faq(
    session: AsyncSession,
    business: Business,
    call: Call,
    state: CallState,
    question: str,
) -> TurnResponse:
    result = await kb_agent.answer(
        session,
        business_id=str(business.id),
        business_name=business.name,
        question=question,
        style=await _playbook(session, business),
    )
    if result.llm:
        await _log_llm_cost(session, business, call, result.llm, CostCategory.LLM)

    if result.answered:
        return TurnResponse(
            text=result.text,
            outcome=CallOutcome.ANSWERED,
            metadata={"kb_sources": result.sources, "kb_confidence": round(result.confidence, 3)},
        )

    # No grounded answer available. Do not let the model improvise.
    return await _escalate(
        business,
        state,
        reason=f"no KB answer above threshold (best={result.confidence:.2f})",
    )


async def _handle_freeform(
    session: AsyncSession,
    business: Business,
    call: Call,
    state: CallState,
) -> TurnResponse:
    settings = get_settings()
    state.clarifying_questions += 1
    if state.clarifying_questions > settings.max_clarifying_questions:
        return await _escalate(
            business, state, reason="exceeded clarifying question limit"
        )

    result = await get_llm().complete(
        _persona(business, playbook=await _playbook(session, business), state=state),
        state.history,
        realtime=True,
        max_tokens=160,
    )
    await _log_llm_cost(session, business, call, result, CostCategory.LLM)

    text = result.text.strip() or (
        "Sorry, I didn't catch that. Are you looking to book an appointment, "
        "or did you have a question?"
    )
    return TurnResponse(text=text)


def _ask(state: CallState, question: str) -> TurnResponse:
    state.clarifying_questions += 1
    return TurnResponse(text=question)


_AFFIRMATIVE = {
    "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "sounds good", "that works",
    "perfect", "great", "works", "book it", "confirm", "correct", "right",
}


def _is_affirmative(text: str) -> bool:
    lowered = text.lower().strip(" .!?")
    return any(token in lowered for token in _AFFIRMATIVE)


async def _log_llm_cost(
    session: AsyncSession,
    business: Business,
    call: Call,
    result: Any,
    category: CostCategory,
) -> None:
    await costs.record(
        session,
        business_id=business.id,
        call_id=call.id,
        category=category,
        provider=result.provider,
        tier=result.tier,
        units=result.total_tokens / 1000 if hasattr(result, "total_tokens") else 1,
        unit_name="1k_tokens",
        cost_usd=getattr(result, "cost_usd", 0.0),
    )
    for attempt in getattr(result, "attempts", []):
        call.provider_log = [*(call.provider_log or []), attempt.__dict__]


async def finalize_call(
    session: AsyncSession,
    *,
    call: Call,
    business: Business,
    transcript: str,
) -> None:
    """Post-call: analyse, score, and settle the cost ledger."""
    from callsentry.services.sentiment import analyse

    analysis = await analyse(transcript, business_name=business.name)

    call.transcript = transcript
    call.summary = analysis.summary
    call.sentiment = analysis.sentiment
    # An escalation flagged mid-call is authoritative; don't let the
    # post-hoc classifier downgrade it.
    if not call.escalated:
        call.outcome = analysis.outcome
    if analysis.escalation_reason and not call.escalation_reason:
        call.escalation_reason = analysis.escalation_reason

    await _log_llm_cost(session, business, call, analysis.llm, CostCategory.LLM)
    call.cost_usd = await costs.recompute_call_cost(session, call.id)

    log.info(
        "call.finalized",
        call_id=str(call.id),
        outcome=call.outcome,
        sentiment=call.sentiment,
        cost_usd=float(call.cost_usd),
    )
