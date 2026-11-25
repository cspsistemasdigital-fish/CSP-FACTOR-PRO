"""Add shared agenda events.

Revision ID: 1f4b8c2d9a30
Revises: c4413d0b0cea
Create Date: 2026-11-23 13:45:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "1f4b8c2d9a30"
down_revision = "c4413d0b0cea"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agenda_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("location", sa.String(length=180), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agenda_events_period", "agenda_events", ["start_at", "end_at"])
    op.create_index("ix_agenda_events_start_at", "agenda_events", ["start_at"])
    op.create_index("ix_agenda_events_is_deleted", "agenda_events", ["is_deleted"])


def downgrade():
    op.drop_index("ix_agenda_events_is_deleted", table_name="agenda_events")
    op.drop_index("ix_agenda_events_start_at", table_name="agenda_events")
    op.drop_index("ix_agenda_events_period", table_name="agenda_events")
    op.drop_table("agenda_events")
