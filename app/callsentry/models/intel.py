from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from callsentry.core.db import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from callsentry.models.call import Call
    from callsentry.models.user import User


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


class LeadStage(StrEnum):
    NEW = "new"
    QUOTED = "quoted"
    FOLLOW_UP = "follow_up"
    WON = "won"
    LOST = "lost"


class Lead(Base, TimestampMixin):
    """A prospect in the sales pipeline, created and moved by sales calls.

    Stage is set from each call's outcome. A manager can move a lead by hand
    (`stage_source = "manual"`); the next call about the same person moves it
    again, because a new conversation is newer information.
    """

    __tablename__ = "leads"
    __table_args__ = (
        Index("uq_leads_business_name_key", "business_id", "name_key", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    name_key: Mapped[str] = mapped_column(String(160), nullable=False)
    stage: Mapped[str] = mapped_column(String(16), nullable=False)
    stage_source: Mapped[str] = mapped_column(
        String(8), default="auto", server_default="auto", nullable=False
    )
    pests: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default="[]", nullable=False
    )
    service: Mapped[str | None] = mapped_column(Text)
    price_quoted: Mapped[str | None] = mapped_column(Text)
    next_step: Mapped[str | None] = mapped_column(Text)
    rep_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("reps.id", ondelete="SET NULL")
    )
    last_call_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("calls.id", ondelete="SET NULL", use_alter=True)
    )
    last_contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


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
    # Every model that took part, e.g. "claude-sonnet-5 + gpt-5".
    model: Mapped[str] = mapped_column(String(160), nullable=False)
    scoring_mode: Mapped[str] = mapped_column(
        String(16), default="standard", server_default="standard", nullable=False
    )
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
    # A manager's corrections to individual steps, keyed by step:
    # {"close": {"status": "met", "by": "...", "at": "...", "note": "..."}}.
    # Kept separately so they survive re-scoring.
    overrides: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default="{}", nullable=False
    )
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), default=0, nullable=False)

    call: Mapped[Call] = relationship(back_populates="analysis")


class ReceptionistPlaybook(Base, TimestampMixin):
    """How the business's best reps handle calls, for the AI receptionist.

    Generated from analysed calls as a draft, reviewed and edited by a
    manager, then published. Only the published row reaches live calls.
    """

    __tablename__ = "receptionist_playbooks"
    __table_args__ = (
        Index("uq_receptionist_playbooks_business_status", "business_id", "status",
              unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    # draft | published
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_calls: Mapped[int] = mapped_column(Integer, default=0, server_default="0",
                                              nullable=False)
    # Entries dropped because they looked like personal or company-specific details.
    removed_items: Mapped[int] = mapped_column(Integer, default=0, server_default="0",
                                               nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FollowUp(Base, TimestampMixin):
    """Something promised to a customer on a call, tracked until done."""

    __tablename__ = "follow_ups"
    __table_args__ = (Index("ix_follow_ups_business_status", "business_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    call_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("calls.id", ondelete="CASCADE"), index=True,
        nullable=False,
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    owner: Mapped[str | None] = mapped_column(String(24))
    due: Mapped[str | None] = mapped_column(String(120))
    # open | done
    status: Mapped[str] = mapped_column(String(8), default="open", server_default="open",
                                        nullable=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_by: Mapped[str | None] = mapped_column(String(320))
    # The team member responsible; loaded with the row, it's always shown.
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    assignee: Mapped[User | None] = relationship(lazy="joined")
