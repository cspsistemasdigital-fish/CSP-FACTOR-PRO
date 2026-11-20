"""document attachments

Revision ID: a7c4e1b9d2f3
Revises: 269e70536ab9
Create Date: 2026-11-17 17:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7c4e1b9d2f3'
down_revision = '269e70536ab9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('document_attachments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('document_kind', sa.String(length=20), nullable=False),
    sa.Column('document_id', sa.Integer(), nullable=False),
    sa.Column('path', sa.String(length=255), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('content_type', sa.String(length=120), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('updated_by_id', sa.Integer(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('deleted_by_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_document_attachments_created_by_id_users')),
    sa.ForeignKeyConstraint(['deleted_by_id'], ['users.id'], name=op.f('fk_document_attachments_deleted_by_id_users')),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_document_attachments_updated_by_id_users')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_document_attachments'))
    )
    with op.batch_alter_table('document_attachments', schema=None) as batch_op:
        batch_op.create_index('ix_document_attachment_document', ['document_kind', 'document_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_document_attachments_document_id'), ['document_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_document_attachments_document_kind'), ['document_kind'], unique=False)
        batch_op.create_index(batch_op.f('ix_document_attachments_is_deleted'), ['is_deleted'], unique=False)


def downgrade():
    with op.batch_alter_table('document_attachments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_document_attachments_is_deleted'))
        batch_op.drop_index(batch_op.f('ix_document_attachments_document_kind'))
        batch_op.drop_index(batch_op.f('ix_document_attachments_document_id'))
        batch_op.drop_index('ix_document_attachment_document')

    op.drop_table('document_attachments')
