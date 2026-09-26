"""scoring mode per call and per analysis

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("calls", sa.Column("scoring_mode", sa.String(16)))
    op.add_column(
        "call_analyses",
        sa.Column("scoring_mode", sa.String(16), server_default="standard", nullable=False),
    )
    op.alter_column("call_analyses", "model", type_=sa.String(160))


def downgrade() -> None:
    op.alter_column("call_analyses", "model", type_=sa.String(64))
    op.drop_column("call_analyses", "scoring_mode")
    op.drop_column("calls", "scoring_mode")
