"""Reusable model helpers: timestamps, soft delete and JSON serialization."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import declared_attr

from ..extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value.isoformat()


def money(value) -> float | None:
    if value is None:
        return None
    return float(Decimal(value).quantize(Decimal("0.01")))


class TimestampMixin:
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    updated_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    @declared_attr
    def created_by(cls):
        return db.relationship("User", foreign_keys=[cls.created_by_id], post_update=True)

    @declared_attr
    def updated_by(cls):
        return db.relationship("User", foreign_keys=[cls.updated_by_id], post_update=True)


class SoftDeleteMixin:
    is_deleted = db.Column(db.Boolean, default=False, nullable=False, index=True)
    deleted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    deleted_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    @declared_attr
    def deleted_by(cls):
        return db.relationship("User", foreign_keys=[cls.deleted_by_id], post_update=True)

    def soft_delete(self, user_id: int | None = None) -> None:
        self.is_deleted = True
        self.deleted_at = utcnow()
        self.deleted_by_id = user_id
