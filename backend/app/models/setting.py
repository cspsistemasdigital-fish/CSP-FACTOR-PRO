"""Key/value settings persistence (company data, operational limits in Etapa 2)."""
from __future__ import annotations

from ..extensions import db
from .base import iso, utcnow


class Setting(db.Model):
    __tablename__ = "settings"

    key = db.Column(db.String(80), primary_key=True)
    value = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    updated_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    updated_by = db.relationship("User")

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "value": self.value,
            "updated_at": iso(self.updated_at),
            "updated_by": self.updated_by.name if self.updated_by else None,
        }
