"""client delinquency block + brand settings

Revision ID: a7c19d4e8b52
Revises: 3746194c79fe
Create Date: 2026-11-17 12:00:00.000000

Brand settings use the existing key/value ``settings`` table (no schema change).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7c19d4e8b52'
down_revision = '3746194c79fe'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('clients', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('is_blocked', sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column('blocked_reason', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('blocked_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('blocked_by_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_clients_is_blocked'), ['is_blocked'], unique=False)
        batch_op.create_foreign_key(
            batch_op.f('fk_clients_blocked_by_id_users'), 'users', ['blocked_by_id'], ['id']
        )
    # Defaults for new brand keys are applied on read by services/settings.py;
    # persist them so admins see/edit them immediately after the upgrade.
    settings = sa.table(
        'settings',
        sa.column('key', sa.String),
        sa.column('value', sa.Text),
        sa.column('updated_at', sa.DateTime(timezone=True)),
    )
    defaults = {
        'app_name': 'FACTOR PRO',
        'logo_path': '',
        'logo_name': '',
        'logo_version': '',
    }
    bind = op.get_bind()
    for key, value in defaults.items():
        exists = bind.execute(
            sa.select(sa.literal_column('1')).select_from(settings).where(settings.c.key == key)
        ).first()
        if not exists:
            op.execute(
                settings.insert().values(key=key, value=value, updated_at=sa.func.now())
            )


def downgrade():
    settings = sa.table('settings', sa.column('key', sa.String))
    op.execute(
        settings.delete().where(
            settings.c.key.in_(['app_name', 'logo_path', 'logo_name', 'logo_version'])
        )
    )
    with op.batch_alter_table('clients', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_clients_blocked_by_id_users'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_clients_is_blocked'))
        batch_op.drop_column('blocked_by_id')
        batch_op.drop_column('blocked_at')
        batch_op.drop_column('blocked_reason')
        batch_op.drop_column('is_blocked')
