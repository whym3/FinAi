"""bundle verification: upright pages, QR codes, stamps, GSP verification

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-25 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RULES = [
    {'id': 'xdoc', 'name': 'Documents disagree', 'type': 'xdoc', 'description': 'Confirmed values differ between the invoice, PO, GRN and transport documents', 'enabled': True, 'priority': 'Medium', 'sla_days': 3, 'default_role': 'ap'},
    {'id': 'pages', 'name': 'Pages missing from a document', 'type': 'pages', 'description': 'A document prints more pages than were received', 'enabled': True, 'priority': 'Medium', 'sla_days': 3, 'default_role': 'ap'},
    {'id': 'einv', 'name': 'E-invoice not valid', 'type': 'einv', 'description': 'The signed e-invoice QR fails verification or differs from the invoice', 'enabled': True, 'priority': 'Critical', 'sla_days': 2, 'default_role': 'gst'},
    {'id': 'ewb', 'name': 'E-way bill does not match', 'type': 'ewb', 'description': 'The e-way bill is not found or differs from the invoice', 'enabled': True, 'priority': 'High', 'sla_days': 3, 'default_role': 'gst'},
]


def upgrade() -> None:
    """Upgrade schema."""
    j = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')
    op.add_column('source_documents', sa.Column('page_rotations', j, server_default='[]', nullable=False))
    op.add_column('source_documents', sa.Column('codes', j, server_default='[]', nullable=False))
    op.add_column('source_documents', sa.Column('annotations', j, server_default='[]', nullable=False))
    op.add_column('gst_registrations', sa.Column('ewb_username', sa.String(length=60), nullable=True))
    op.add_column('gst_registrations', sa.Column('enc_ewb_password', sa.Text(), nullable=True))
    op.create_table('gsp_settings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('environment', sa.String(length=10), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('enc_password', sa.Text(), nullable=True),
    sa.Column('org_id', sa.String(length=80), nullable=False),
    sa.Column('enc_token', sa.Text(), nullable=True),
    sa.Column('token_expiry', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_test_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_test_result', sa.Text(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('verifications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('entity_id', sa.String(length=40), nullable=False),
    sa.Column('invoice_id', sa.Integer(), nullable=True),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('ref', sa.String(length=80), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('task_id', sa.String(length=80), nullable=True),
    sa.Column('detail', j, nullable=False),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('polls', sa.Integer(), nullable=False),
    sa.Column('checked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['entity_id'], ['entities.id'], ),
    sa.ForeignKeyConstraint(['invoice_id'], ['supplier_invoices.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_verifications_entity_id', 'verifications', ['entity_id'])
    op.create_index('ix_verifications_invoice_id', 'verifications', ['invoice_id'])
    op.create_index('ix_verifications_ref', 'verifications', ['entity_id', 'kind', 'ref'])
    rules = sa.table('exception_rules', *[sa.column(c) for c in ('id', 'name', 'type', 'description', 'enabled', 'priority', 'sla_days', 'default_role')])
    op.bulk_insert(rules, RULES)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(sa.text("DELETE FROM exception_rules WHERE id IN ('xdoc', 'pages', 'einv', 'ewb')"))
    op.drop_index('ix_verifications_ref', table_name='verifications')
    op.drop_index('ix_verifications_invoice_id', table_name='verifications')
    op.drop_index('ix_verifications_entity_id', table_name='verifications')
    op.drop_table('verifications')
    op.drop_table('gsp_settings')
    op.drop_column('gst_registrations', 'enc_ewb_password')
    op.drop_column('gst_registrations', 'ewb_username')
    op.drop_column('source_documents', 'annotations')
    op.drop_column('source_documents', 'codes')
    op.drop_column('source_documents', 'page_rotations')
