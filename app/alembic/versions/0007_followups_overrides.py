"""follow-up tasks and manager overrides

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "follow_ups",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("call_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("owner", sa.String(24)),
        sa.Column("due", sa.String(120)),
        sa.Column("status", sa.String(8), server_default="open", nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True)),
        sa.Column("done_by", sa.String(320)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"],
                                name="fk_follow_ups_business_id_businesses", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["call_id"], ["calls.id"],
                                name="fk_follow_ups_call_id_calls", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_follow_ups"),
    )
    op.create_index("ix_follow_ups_business_status", "follow_ups", ["business_id", "status"])
    op.create_index("ix_follow_ups_call_id", "follow_ups", ["call_id"])
    op.add_column(
        "call_analyses",
        sa.Column("overrides", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"),
                  nullable=False),
    )


def downgrade() -> None:
    op.drop_column("call_analyses", "overrides")
    op.drop_index("ix_follow_ups_call_id", table_name="follow_ups")
    op.drop_index("ix_follow_ups_business_status", table_name="follow_ups")
    op.drop_table("follow_ups")
