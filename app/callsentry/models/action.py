from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from callsentry.core.db import Base, TimestampMixin, uuid_pk


class OwnerAction(Base, TimestampMixin):
    """One thing the app has prepared for the owner to do, ready to send.

    Made from the open work on Today (a lead to chase, a cancel to win back, a
    problem to check on, a rep to coach). `item_key` names that situation, so
    the same lead isn't offered twice; a new call about it makes a new key.
    Each situation can have more than one way to act (text the customer, or
    ask the rep to call); doing one sets the others aside.
    """

    __tablename__ = "owner_actions"
    __table_args__ = (
        Index("uq_owner_actions_item_kind", "business_id", "item_key", "kind", unique=True),
        Index("ix_owner_actions_business_status", "business_id", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    item_key: Mapped[str] = mapped_column(String(160), nullable=False)
    # text_customer | remind_rep | coach_rep
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    # proposed | done | failed | dismissed | expired
    status: Mapped[str] = mapped_column(String(16), default="proposed", server_default="proposed",
                                        nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    # The button, e.g. "Text Sarah" or "Ask Mike to call".
    label: Mapped[str] = mapped_column(Text, nullable=False)
    why: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    to_phone: Mapped[str | None] = mapped_column(String(32))
    to_name: Mapped[str | None] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Yearly value of the work it moves forward, when there is a price.
    value_usd: Mapped[float | None] = mapped_column(Numeric(10, 2))
    href: Mapped[str | None] = mapped_column(Text)
    lead_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("leads.id", ondelete="SET NULL")
    )
    call_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("calls.id", ondelete="SET NULL")
    )
    rep_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("reps.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_by: Mapped[str | None] = mapped_column(String(320))
    # Done by autopilot rather than a person's tap or text.
    auto: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false",
                                       nullable=False)
    message_sid: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    # The customer's text back, forwarded to the owner.
    reply_text: Mapped[str | None] = mapped_column(Text)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # A coaching card: when the rep opened it, and when they played the clip.
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    listened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SmsOptOut(Base, TimestampMixin):
    """A number that texted STOP. Nothing is texted to it again until START."""

    __tablename__ = "sms_opt_outs"
    __table_args__ = (Index("uq_sms_opt_outs_business_phone", "business_id", "phone",
                            unique=True),)

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    phone: Mapped[str] = mapped_column(String(32), nullable=False)


class OutboxMessage(Base, TimestampMixin):
    """A text in practice mode: shown in the app instead of sent.

    Replies typed in the Outbox are kept here too, so the conversation reads
    the way it would on a phone.
    """

    __tablename__ = "outbox_messages"
    __table_args__ = (Index("ix_outbox_messages_business_created", "business_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    # out: the app texting someone; in: a reply typed in the Outbox.
    direction: Mapped[str] = mapped_column(String(4), nullable=False)
    # The other side of the conversation (who it went to, or who replied).
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str | None] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # morning | customer | rep | coach | forward | answer | reply
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    action_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("owner_actions.id", ondelete="SET NULL")
    )
