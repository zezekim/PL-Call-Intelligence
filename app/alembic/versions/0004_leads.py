"""leads pipeline and call type override

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "leads",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("name_key", sa.String(160), nullable=False),
        sa.Column("stage", sa.String(16), nullable=False),
        sa.Column("stage_source", sa.String(8), server_default="auto", nullable=False),
        sa.Column("pests", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"),
                  nullable=False),
        sa.Column("service", sa.Text()),
        sa.Column("price_quoted", sa.Text()),
        sa.Column("next_step", sa.Text()),
        sa.Column("rep_id", postgresql.UUID(as_uuid=True)),
        sa.Column("last_call_id", postgresql.UUID(as_uuid=True)),
        sa.Column("last_contact_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"],
                                name="fk_leads_business_id_businesses", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rep_id"], ["reps.id"],
                                name="fk_leads_rep_id_reps", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["last_call_id"], ["calls.id"],
                                name="fk_leads_last_call_id_calls", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_leads"),
    )
    op.create_index("uq_leads_business_name_key", "leads", ["business_id", "name_key"],
                    unique=True)
    op.add_column("calls", sa.Column("lead_id", postgresql.UUID(as_uuid=True)))
    op.create_foreign_key("fk_calls_lead_id_leads", "calls", "leads", ["lead_id"], ["id"],
                          ondelete="SET NULL")
    op.create_index("ix_calls_lead_id", "calls", ["lead_id"])
    op.add_column("calls", sa.Column("call_type_override", sa.String(24)))


def downgrade() -> None:
    op.drop_column("calls", "call_type_override")
    op.drop_index("ix_calls_lead_id", table_name="calls")
    op.drop_constraint("fk_calls_lead_id_leads", "calls", type_="foreignkey")
    op.drop_column("calls", "lead_id")
    op.drop_index("uq_leads_business_name_key", table_name="leads")
    op.drop_table("leads")
