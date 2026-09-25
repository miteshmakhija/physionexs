"""google sign-in and password reset codes

Revision ID: 3eeb02174168
Revises: a8abe38c6ee1
Create Date: 2026-09-25 18:20:57.765029

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3eeb02174168'
down_revision: Union[str, Sequence[str], None] = 'a8abe38c6ee1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column("otp_requests", "phone", new_column_name="destination", type_=sa.String(length=254), existing_nullable=False)
    op.execute("ALTER INDEX IF EXISTS ix_otp_requests_phone RENAME TO ix_otp_requests_destination")
    op.add_column("users", sa.Column("google_sub", sa.String(length=64), nullable=True))
    op.create_unique_constraint("uq_users_google_sub", "users", ["google_sub"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("uq_users_google_sub", "users", type_="unique")
    op.drop_column("users", "google_sub")
    op.execute("ALTER INDEX IF EXISTS ix_otp_requests_destination RENAME TO ix_otp_requests_phone")
    op.alter_column("otp_requests", "destination", new_column_name="phone", type_=sa.String(length=20), existing_nullable=False)
