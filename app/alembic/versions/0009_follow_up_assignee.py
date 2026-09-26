"""follow-up assignee

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "follow_ups",
        sa.Column(
            "assignee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
    )
    op.create_index("ix_follow_ups_assignee_id", "follow_ups", ["assignee_id"])


def downgrade() -> None:
    op.drop_index("ix_follow_ups_assignee_id", table_name="follow_ups")
    op.drop_column("follow_ups", "assignee_id")
