"""Merge client branding and loan attachment migrations

Revision ID: c4413d0b0cea
Revises: a7c19d4e8b52, a7c4e1b9d2f3
Create Date: 2026-11-20 11:22:38.829378

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c4413d0b0cea'
down_revision = ('a7c19d4e8b52', 'a7c4e1b9d2f3')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
