"""practice mode: texts shown in an in-app outbox

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("businesses", sa.Column("practice_mode", sa.Boolean(), server_default="false",
                                          nullable=False))
    op.create_table(
        "outbox_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("business_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("direction", sa.String(4), nullable=False),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160)),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("action_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("owner_actions.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_index("ix_outbox_messages_business_created", "outbox_messages",
                    ["business_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_outbox_messages_business_created", table_name="outbox_messages")
    op.drop_table("outbox_messages")
    op.drop_column("businesses", "practice_mode")
