"""consultation assessment form

Revision ID: 5b2e9c41d7a3
Revises: fcb3bbeb3ae0
Create Date: 2026-11-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '5b2e9c41d7a3'
down_revision: Union[str, Sequence[str], None] = 'fcb3bbeb3ae0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('consultations', sa.Column('assessment_form', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('consultations', sa.Column('form_version', sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('consultations', 'form_version')
    op.drop_column('consultations', 'assessment_form')
