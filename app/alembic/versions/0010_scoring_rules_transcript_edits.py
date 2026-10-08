"""scoring rules and transcript edits

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scoring_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "business_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("businesses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scorecard_key", sa.String(24), nullable=False),
        sa.Column("step_key", sa.String(64), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_by", sa.String(320)),
        sa.Column(
            "source_call_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("calls.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_scoring_rules_business_scorecard", "scoring_rules", ["business_id", "scorecard_key"]
    )
    op.add_column("calls", sa.Column("transcript_edited_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("calls", "transcript_edited_at")
    op.drop_index("ix_scoring_rules_business_scorecard", table_name="scoring_rules")
    op.drop_table("scoring_rules")
