"""Owner-level aggregates over analysed calls: the three lenses, reps, training."""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from callsentry.intel.rubrics import CALL_TYPE_LABELS, LENS_BY_CALL_TYPE
from callsentry.models import Call, CallAnalysis, FollowUp, ProcessingStatus, Rep

# Below this the classifier's call type is shown as "needs review".
REVIEW_CONFIDENCE = 0.7


@dataclass
class Row:
    call: Call
    analysis: CallAnalysis

    @property
    def pct(self) -> float | None:
        a = self.analysis
        return a.score / a.score_max * 100 if a.score_max and a.score is not None else None

    @property
    def when(self) -> datetime:
        return self.call.occurred_at or self.call.created_at


def _window(days: int | None) -> datetime | None:
    return datetime.now(UTC) - timedelta(days=days) if days else None


async def load(
    session: AsyncSession,
    business_id: uuid.UUID,
    *,
    days: int | None = None,
    rep_id: uuid.UUID | None = None,
) -> list[Row]:
    stmt = (
        select(Call, CallAnalysis)
        .join(CallAnalysis, CallAnalysis.call_id == Call.id)
        .where(Call.business_id == business_id,
               or_(Call.audio_path.isnot(None), Call.stt_provider.isnot(None)),
               Call.processing_status == ProcessingStatus.DONE)
        .options(selectinload(Call.rep))
    )
    since = _window(days)
    if since is not None:
        stmt = stmt.where(func.coalesce(Call.occurred_at, Call.created_at) >= since)
    if rep_id is not None:
        stmt = stmt.where(Call.rep_id == rep_id)
    rows = (await session.execute(stmt)).all()
    return sorted((Row(c, a) for c, a in rows), key=lambda r: r.when, reverse=True)


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _rate(num: int, den: int) -> float | None:
    return round(num / den * 100, 1) if den else None


def needs_review(row: Row) -> bool:
    return (
        not row.call.call_type_override
        and float(row.analysis.call_type_confidence or 0) < REVIEW_CONFIDENCE
    )


# A step the two models still disagree on after deliberating, with no
# manager ruling yet. It counts as not awarded until someone reviews it.
DISPUTED_PATH = '$[*] ? (@.agreement == "disputed" && !exists(@.override))'


def disputed_steps(items: list[dict[str, Any]]) -> int:
    return sum(1 for i in items if i.get("agreement") == "disputed" and not i.get("override"))


# Steps that share a label within a scorecard; the quadrant tells them apart.
_AMBIGUOUS = {"expectation_statement_1", "expectation_statement_2"}


def step_label(item: dict[str, Any]) -> str:
    label = str(item.get("label") or item.get("key") or "")
    if item.get("key") in _AMBIGUOUS:
        return f"{label} ({item.get('quadrant', '')})"
    return label


def missed_steps(rows: list[Row], *, limit: int = 5) -> list[dict[str, Any]]:
    """The scorecard steps missed most often - what to train on."""
    missed: Counter[str] = Counter()
    seen: Counter[str] = Counter()
    example: dict[str, str] = {}
    for row in rows:
        for item in row.analysis.items or []:
            label = step_label(item)
            seen[label] += 1
            if not item.get("awarded"):
                missed[label] += 1
                example.setdefault(label, str(row.call.id))
    ranked = sorted(missed, key=lambda k: (missed[k], missed[k] / seen[k]), reverse=True)
    return [
        {"step": k, "missed": missed[k], "of": seen[k], "pct": _rate(missed[k], seen[k]),
         "example_call_id": example.get(k)}
        for k in ranked[:limit]
    ]


def _grades(rows: list[Row]) -> dict[str, int]:
    counts = Counter(r.analysis.grade for r in rows if r.analysis.grade)
    return {g: counts.get(g, 0) for g in ("gold", "green", "below")}


def _ref(row: Row) -> dict[str, Any]:
    return {
        "call_id": str(row.call.id),
        "ref": row.call.external_ref,
        "customer": row.analysis.customer_name,
        "rep": row.call.rep.name if row.call.rep else row.analysis.rep_name,
        "when": row.when.isoformat(),
    }


def sales_lens(rows: list[Row]) -> dict[str, Any]:
    sales = [r for r in rows if LENS_BY_CALL_TYPE.get(r.analysis.call_type) == "sales"]
    outcomes = Counter(r.analysis.outcome for r in sales)
    decided = outcomes["sold"] + outcomes["not_sold"] + outcomes["follow_up"]
    objections = [
        {**_ref(r), "objection": o.get("objection", "")}
        for r in sales
        for o in ((r.analysis.triage or {}).get("sales") or {}).get("objections") or []
    ]
    lost = [
        {**_ref(r), "reason": ((r.analysis.triage or {}).get("sales") or {}).get("lost_reason")
         or r.analysis.summary}
        for r in sales if r.analysis.outcome in ("not_sold", "follow_up")
    ]
    return {
        "calls": len(sales),
        "sold": outcomes["sold"],
        "follow_up": outcomes["follow_up"],
        "not_sold": outcomes["not_sold"],
        "close_rate": _rate(outcomes["sold"], decided),
        "avg_score_pct": _avg([p for r in sales if (p := r.pct) is not None]),
        "grades": _grades(sales),
        "missed_steps": missed_steps(sales),
        "objections": objections[:8],
        "not_closed": lost[:8],
    }


def retention_lens(rows: list[Row]) -> dict[str, Any]:
    ret = [r for r in rows if LENS_BY_CALL_TYPE.get(r.analysis.call_type) == "retention"]
    outcomes = Counter(r.analysis.outcome for r in ret)
    reasons: Counter[str] = Counter()
    offers: Counter[str] = Counter()
    lost = []
    for r in ret:
        block = (r.analysis.triage or {}).get("retention") or {}
        if block.get("cancel_reason") and block["cancel_reason"] != "not_applicable":
            reasons[block["cancel_reason"]] += 1
        offers.update(block.get("offers_made") or [])
        if r.analysis.outcome == "cancelled":
            lost.append({**_ref(r), "reason": block.get("cancel_reason"),
                         "root_cause": block.get("root_cause"),
                         "offers_made": block.get("offers_made") or []})
    decided = outcomes["saved"] + outcomes["cancelled"]
    return {
        "calls": len(ret),
        "saved": outcomes["saved"],
        "cancelled": outcomes["cancelled"],
        "pending": outcomes["pending"],
        "save_rate": _rate(outcomes["saved"], decided),
        "avg_score_pct": _avg([p for r in ret if (p := r.pct) is not None]),
        "grades": _grades(ret),
        "reasons": [{"reason": k, "count": v} for k, v in reasons.most_common()],
        "offers": [{"offer": k, "count": v} for k, v in offers.most_common()],
        "no_offer_calls": sum(
            1 for r in ret
            if not ((r.analysis.triage or {}).get("retention") or {}).get("offers_made")
        ),
        "missed_steps": missed_steps(ret),
        "not_saved": lost[:8],
    }


def service_lens(rows: list[Row]) -> dict[str, Any]:
    svc = [r for r in rows if LENS_BY_CALL_TYPE.get(r.analysis.call_type) == "service"]
    outcomes = Counter(r.analysis.outcome for r in svc)
    by_type = Counter(r.analysis.call_type for r in svc)
    decided = outcomes["resolved"] + outcomes["partially"] + outcomes["unresolved"]
    return {
        "calls": len(svc),
        "by_type": [
            {"call_type": t, "label": CALL_TYPE_LABELS.get(t, t), "count": n}
            for t, n in by_type.most_common()
        ],
        "resolved": outcomes["resolved"],
        "partially": outcomes["partially"],
        "unresolved": outcomes["unresolved"],
        "resolution_rate": _rate(outcomes["resolved"], decided),
        "avg_score_pct": _avg([p for r in svc if (p := r.pct) is not None]),
        "grades": _grades(svc),
        "missed_steps": missed_steps(svc),
        "unresolved_calls": [
            {**_ref(r), "summary": r.analysis.summary}
            for r in svc if r.analysis.outcome in ("unresolved", "partially")
        ][:8],
    }


def follow_ups(rows: list[Row], *, limit: int = 12) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        for f in (r.analysis.triage or {}).get("follow_ups") or []:
            if f.get("owner") == "customer":
                continue
            out.append({**_ref(r), "action": f.get("action"), "owner": f.get("owner"),
                        "due": f.get("due")})
    return out[:limit]


async def overview(session: AsyncSession, business_id: uuid.UUID, days: int | None) -> dict:
    rows = await load(session, business_id, days=days)
    scored = [r for r in rows if r.pct is not None]
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
    in_progress = sum(v for k, v in status_counts.items()
                      if k not in (ProcessingStatus.DONE, ProcessingStatus.FAILED))
    open_follow_ups = (
        await session.execute(
            select(FollowUp, Call, CallAnalysis)
            .join(Call, Call.id == FollowUp.call_id)
            .outerjoin(CallAnalysis, CallAnalysis.call_id == Call.id)
            .where(FollowUp.business_id == business_id, FollowUp.status == "open")
            .options(selectinload(Call.rep))
            .order_by(FollowUp.created_at.desc())
        )
    ).all()
    return {
        "as_of": datetime.now(UTC).isoformat(),
        "days": days,
        "scorecard": {
            "calls": len(rows),
            "scored": len(scored),
            "avg_score_pct": _avg([p for r in scored if (p := r.pct) is not None]),
            "grades": _grades(scored),
            "needs_review": sum(1 for r in rows if needs_review(r)),
            "disputed_calls": sum(1 for r in rows if disputed_steps(r.analysis.items or [])),
            "in_progress": in_progress,
            "failed": status_counts.get(ProcessingStatus.FAILED, 0),
        },
        "sales": sales_lens(rows),
        "retention": retention_lens(rows),
        "service": service_lens(rows),
        "training": missed_steps(scored, limit=6),
        "follow_ups": [
            {"id": str(f.id), "call_id": str(c.id), "ref": c.external_ref,
             "customer": a.customer_name if a else None,
             "rep": c.rep.name if c.rep else None,
             "when": (c.occurred_at or c.created_at).isoformat(),
             "action": f.action, "owner": f.owner, "due": f.due}
            for f, c, a in open_follow_ups
        ],
        "review": [{**_ref(r), "call_type": r.analysis.call_type,
                    "confidence": float(r.analysis.call_type_confidence or 0)}
                   for r in rows if needs_review(r)],
    }


def item_rates(rows: list[Row]) -> list[dict[str, Any]]:
    """Hit rate per scorecard step, in scorecard order."""
    met: Counter[str] = Counter()
    seen: Counter[str] = Counter()
    order: dict[str, tuple[int, str]] = {}
    for row in rows:
        for index, item in enumerate(row.analysis.items or []):
            label = step_label(item)
            order.setdefault(label, (index, item.get("quadrant", "")))
            seen[label] += 1
            if item.get("awarded"):
                met[label] += 1
    return [
        {"step": k, "quadrant": order[k][1], "met": met[k], "of": seen[k],
         "pct": _rate(met[k], seen[k])}
        for k in sorted(seen, key=lambda k: order[k][0])
    ]


def rep_summary(rep: Rep, rows: list[Row]) -> dict[str, Any]:
    scored = [r for r in rows if r.pct is not None]
    sales = sales_lens(rows)
    retention = retention_lens(rows)
    rates = [r for r in item_rates(scored) if r["of"] >= 1]
    strongest = max(rates, key=lambda r: (r["pct"] or 0, r["of"]), default=None)
    weakest = min(rates, key=lambda r: (r["pct"] or 0, -r["of"]), default=None)
    lens_counts = Counter(LENS_BY_CALL_TYPE.get(r.analysis.call_type, "other") for r in rows)
    return {
        "id": str(rep.id),
        "name": rep.name,
        "calls": len(rows),
        "scored": len(scored),
        "avg_score_pct": _avg([p for r in scored if (p := r.pct) is not None]),
        "grades": _grades(scored),
        "lenses": dict(lens_counts),
        "close_rate": sales["close_rate"],
        "sales_calls": sales["calls"],
        "save_rate": retention["save_rate"],
        "strongest": strongest["step"] if strongest else None,
        "weakest": weakest["step"] if weakest else None,
    }


async def reps(session: AsyncSession, business_id: uuid.UUID, days: int | None) -> list[dict]:
    rows = await load(session, business_id, days=days)
    by_rep: dict[uuid.UUID, list[Row]] = defaultdict(list)
    for r in rows:
        if r.call.rep_id:
            by_rep[r.call.rep_id].append(r)
    rep_rows = (
        await session.scalars(select(Rep).where(Rep.business_id == business_id))
    ).all()
    out = [rep_summary(rep, by_rep.get(rep.id, [])) for rep in rep_rows]
    return sorted(out, key=lambda r: (-(r["calls"] or 0), r["name"]))


async def rep_detail(
    session: AsyncSession, business_id: uuid.UUID, rep_id: uuid.UUID, days: int | None
) -> dict[str, Any] | None:
    rep = await session.get(Rep, rep_id)
    if rep is None or rep.business_id != business_id:
        return None
    rows = await load(session, business_id, days=days, rep_id=rep_id)
    scored = [r for r in rows if r.pct is not None]
    by_scorecard: dict[str, list[Row]] = defaultdict(list)
    for r in scored:
        by_scorecard[r.analysis.scorecard_key or ""].append(r)

    coaching = []
    strengths = []
    for r in rows:
        c = r.analysis.coaching or {}
        for tip in c.get("coaching") or []:
            coaching.append({**_ref(r), "title": tip.get("title"),
                             "try_saying": tip.get("try_saying"),
                             "start": tip.get("start")})
        for s in c.get("strengths") or []:
            strengths.append({**_ref(r), "title": s.get("title"), "detail": s.get("detail"),
                              "start": s.get("start")})
    return {
        **rep_summary(rep, rows),
        "scorecards": [
            {"scorecard": key, "calls": len(group), "steps": item_rates(group)}
            for key, group in sorted(by_scorecard.items(), key=lambda kv: -len(kv[1]))
        ],
        "training": missed_steps(scored, limit=4),
        "coaching": coaching[:12],
        "strengths": strengths[:8],
        "trend": [
            {"call_id": str(r.call.id), "ref": r.call.external_ref, "when": r.when.isoformat(),
             "pct": round(r.pct, 1) if r.pct is not None else None, "grade": r.analysis.grade}
            for r in sorted(scored, key=lambda r: r.when)
        ],
    }
