"""Allow operations to include loans.

Revision ID: 2a9c6d1e4f80
Revises: 1f4b8c2d9a30
Create Date: 2026-11-25 08:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "2a9c6d1e4f80"
down_revision = "1f4b8c2d9a30"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("loans") as batch_op:
        batch_op.add_column(sa.Column("operation_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_loans_operation_id_operations",
            "operations",
            ["operation_id"],
            ["id"],
        )
    op.create_index("ix_loans_operation_id", "loans", ["operation_id"])


def downgrade():
    op.drop_index("ix_loans_operation_id", table_name="loans")
    with op.batch_alter_table("loans") as batch_op:
        batch_op.drop_constraint("fk_loans_operation_id_operations", type_="foreignkey")
        batch_op.drop_column("operation_id")
