"""prepared owner actions, morning text, rep and lead phones

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def _uuid_fk(name: str, table: str, ondelete: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True),
                     sa.ForeignKey(f"{table}.id", ondelete=ondelete), nullable=nullable)


def upgrade() -> None:
    now = sa.func.now()
    op.create_table(
        "owner_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _uuid_fk("business_id", "businesses", "CASCADE", nullable=False),
        sa.Column("item_key", sa.String(160), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("status", sa.String(16), server_default="proposed", nullable=False),
        sa.Column("priority", sa.Integer(), server_default="0", nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("why", sa.Text(), server_default="", nullable=False),
        sa.Column("to_phone", sa.String(32)),
        sa.Column("to_name", sa.String(160)),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("value_usd", sa.Numeric(10, 2)),
        sa.Column("href", sa.Text()),
        _uuid_fk("lead_id", "leads", "SET NULL"),
        _uuid_fk("call_id", "calls", "SET NULL"),
        _uuid_fk("rep_id", "reps", "SET NULL"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True)),
        sa.Column("done_by", sa.String(320)),
        sa.Column("auto", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("message_sid", sa.String(64)),
        sa.Column("error", sa.Text()),
        sa.Column("reply_text", sa.Text()),
        sa.Column("replied_at", sa.DateTime(timezone=True)),
        sa.Column("opened_at", sa.DateTime(timezone=True)),
        sa.Column("listened_at", sa.DateTime(timezone=True)),
    )
    op.create_index("uq_owner_actions_item_kind", "owner_actions",
                    ["business_id", "item_key", "kind"], unique=True)
    op.create_index("ix_owner_actions_business_status", "owner_actions",
                    ["business_id", "status"])
    op.create_table(
        "sms_opt_outs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _uuid_fk("business_id", "businesses", "CASCADE", nullable=False),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
    )
    op.create_index("uq_sms_opt_outs_business_phone", "sms_opt_outs", ["business_id", "phone"],
                    unique=True)
    op.add_column("businesses", sa.Column("owner_phone", sa.String(32)))
    op.add_column("businesses", sa.Column("morning_text", sa.Boolean(), server_default="false",
                                          nullable=False))
    op.add_column("businesses", sa.Column("autopilot", postgresql.JSONB(), server_default="{}",
                                          nullable=False))
    op.add_column("reps", sa.Column("phone", sa.String(32)))
    op.add_column("leads", sa.Column("phone", sa.String(32)))


def downgrade() -> None:
    op.drop_column("leads", "phone")
    op.drop_column("reps", "phone")
    op.drop_column("businesses", "autopilot")
    op.drop_column("businesses", "morning_text")
    op.drop_column("businesses", "owner_phone")
    op.drop_index("uq_sms_opt_outs_business_phone", table_name="sms_opt_outs")
    op.drop_table("sms_opt_outs")
    op.drop_index("ix_owner_actions_business_status", table_name="owner_actions")
    op.drop_index("uq_owner_actions_item_kind", table_name="owner_actions")
    op.drop_table("owner_actions")
