from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def str_enum(enum_cls: type[StrEnum], length: int = 24) -> SAEnum:
    """Store a StrEnum as VARCHAR + CHECK constraint (no native PG enum, so adding values is a simple migration)."""
    return SAEnum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
        name=enum_cls.__name__.lower(),
    )
