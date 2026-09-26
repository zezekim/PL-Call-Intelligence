"""call intelligence: uploaded recordings, reps, analyses

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reps",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("name_key", sa.String(120), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["business_id"], ["businesses.id"],
            name="fk_reps_business_id_businesses", ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_reps"),
    )
    op.create_index(
        "uq_reps_business_name_key", "reps", ["business_id", "name_key"], unique=True
    )

    op.add_column("calls", sa.Column("source", sa.String(16), server_default="twilio",
                                     nullable=False))
    op.add_column("calls", sa.Column("external_ref", sa.String(64)))
    op.add_column("calls", sa.Column("original_filename", sa.String(255)))
    op.add_column("calls", sa.Column("audio_path", sa.Text()))
    op.add_column("calls", sa.Column("audio_channels", sa.Integer()))
    op.add_column("calls", sa.Column("occurred_at", sa.DateTime(timezone=True)))
    op.add_column("calls", sa.Column("processing_status", sa.String(16), server_default="done",
                                     nullable=False))
    op.add_column("calls", sa.Column("processing_error", sa.Text()))
    op.add_column("calls", sa.Column("stt_engine", sa.String(16)))
    op.add_column("calls", sa.Column("stt_provider", sa.String(32)))
    op.add_column(
        "calls",
        sa.Column("segments", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"),
                  nullable=False),
    )
    op.add_column("calls", sa.Column("call_type", sa.String(24)))
    op.add_column("calls", sa.Column("rep_id", postgresql.UUID(as_uuid=True)))
    op.add_column("calls", sa.Column("score", sa.Integer()))
    op.add_column("calls", sa.Column("score_max", sa.Integer()))
    op.add_column("calls", sa.Column("grade", sa.String(8)))
    op.create_foreign_key(
        "fk_calls_rep_id_reps", "calls", "reps", ["rep_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_calls_call_type", "calls", ["call_type"])
    op.create_index("ix_calls_rep_id", "calls", ["rep_id"])
    # The job runner claims work by status; keep that scan cheap.
    op.create_index("ix_calls_processing_status", "calls", ["processing_status"])

    op.create_table(
        "call_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("call_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("prompt_version", sa.String(16), nullable=False),
        sa.Column("call_type", sa.String(24), nullable=False),
        sa.Column("call_type_confidence", sa.Numeric(4, 3), server_default="0", nullable=False),
        sa.Column("lens", sa.String(16)),
        sa.Column("outcome", sa.String(24)),
        sa.Column("rep_name", sa.String(120)),
        sa.Column("customer_name", sa.String(160)),
        sa.Column("summary", sa.Text()),
        sa.Column("scorecard_key", sa.String(24)),
        sa.Column("score", sa.Integer()),
        sa.Column("score_max", sa.Integer()),
        sa.Column("grade", sa.String(8)),
        sa.Column("evidence_verified_pct", sa.Numeric(5, 1)),
        sa.Column("triage", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"),
                  nullable=False),
        sa.Column("items", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"),
                  nullable=False),
        sa.Column("coaching", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"),
                  nullable=False),
        sa.Column("cost_usd", sa.Numeric(10, 6), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["call_id"], ["calls.id"],
            name="fk_call_analyses_call_id_calls", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"], ["businesses.id"],
            name="fk_call_analyses_business_id_businesses", ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_call_analyses"),
        sa.UniqueConstraint("call_id", name="uq_call_analyses_call_id"),
    )
    op.create_index("ix_call_analyses_business_id", "call_analyses", ["business_id"])


def downgrade() -> None:
    op.drop_index("ix_call_analyses_business_id", table_name="call_analyses")
    op.drop_table("call_analyses")
    op.drop_index("ix_calls_processing_status", table_name="calls")
    op.drop_index("ix_calls_rep_id", table_name="calls")
    op.drop_index("ix_calls_call_type", table_name="calls")
    op.drop_constraint("fk_calls_rep_id_reps", "calls", type_="foreignkey")
    for column in (
        "grade", "score_max", "score", "rep_id", "call_type", "segments", "stt_provider",
        "stt_engine", "processing_error", "processing_status", "occurred_at",
        "audio_channels", "audio_path", "original_filename", "external_ref", "source",
    ):
        op.drop_column("calls", column)
    op.drop_index("uq_reps_business_name_key", table_name="reps")
    op.drop_table("reps")
