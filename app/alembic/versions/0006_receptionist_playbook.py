"""receptionist playbook

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "receptionist_playbooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source_calls", sa.Integer(), server_default="0", nullable=False),
        sa.Column("removed_items", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["business_id"], ["businesses.id"],
            name="fk_receptionist_playbooks_business_id_businesses", ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_receptionist_playbooks"),
    )
    op.create_index(
        "uq_receptionist_playbooks_business_status", "receptionist_playbooks",
        ["business_id", "status"], unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_receptionist_playbooks_business_status",
                  table_name="receptionist_playbooks")
    op.drop_table("receptionist_playbooks")
