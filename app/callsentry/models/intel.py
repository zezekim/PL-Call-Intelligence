from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from callsentry.core.db import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from callsentry.models.call import Call


class Rep(Base, TimestampMixin):
    """A person who answers calls, identified from how they introduce themselves."""

    __tablename__ = "reps"
    __table_args__ = (
        Index("uq_reps_business_name_key", "business_id", "name_key", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Lower-cased first name: "Michelle", "michelle" and "Michelle S." are one rep.
    name_key: Mapped[str] = mapped_column(String(120), nullable=False)

    calls: Mapped[list[Call]] = relationship(back_populates="rep")


class CallAnalysis(Base, TimestampMixin):
    """The latest classification, score and coaching for one call.

    One row per call, replaced on re-analysis. `triage`, `items` and `coaching`
    keep the full structured output so the UI can show evidence; the scalar
    columns exist for filtering and aggregation.
    """

    __tablename__ = "call_analyses"

    id: Mapped[uuid.UUID] = uuid_pk()
    call_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("calls.id", ondelete="CASCADE"),
        unique=True, nullable=False,
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(16), nullable=False)

    call_type: Mapped[str] = mapped_column(String(24), nullable=False)
    call_type_confidence: Mapped[float] = mapped_column(
        Numeric(4, 3), default=0, server_default="0", nullable=False
    )
    lens: Mapped[str | None] = mapped_column(String(16))
    # sold / not_sold / follow_up / saved / cancelled / resolved / unresolved ...
    outcome: Mapped[str | None] = mapped_column(String(24))
    rep_name: Mapped[str | None] = mapped_column(String(120))
    customer_name: Mapped[str | None] = mapped_column(String(160))
    summary: Mapped[str | None] = mapped_column(Text)

    scorecard_key: Mapped[str | None] = mapped_column(String(24))
    score: Mapped[int | None] = mapped_column(Integer)
    score_max: Mapped[int | None] = mapped_column(Integer)
    grade: Mapped[str | None] = mapped_column(String(8))
    # Share of cited quotes found verbatim (or near-verbatim) in the transcript.
    evidence_verified_pct: Mapped[float | None] = mapped_column(Numeric(5, 1))

    triage: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    coaching: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), default=0, nullable=False)

    call: Mapped[Call] = relationship(back_populates="analysis")
