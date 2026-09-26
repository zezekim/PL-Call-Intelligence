"""upload fingerprint and manual rep assignment

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("calls", sa.Column("audio_sha256", sa.String(64)))
    op.create_index("ix_calls_audio_sha256", "calls", ["audio_sha256"])
    op.add_column(
        "calls",
        sa.Column("rep_locked", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("calls", "rep_locked")
    op.drop_index("ix_calls_audio_sha256", table_name="calls")
    op.drop_column("calls", "audio_sha256")
