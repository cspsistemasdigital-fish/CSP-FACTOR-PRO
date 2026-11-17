"""User-saved report filters (Etapa 5).

Preferences are private to the authenticated user and support logical deletion,
keeping the same audit-friendly conventions as the rest of the system.
"""
from __future__ import annotations

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso


class ReportFilter(db.Model, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "report_filters"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    name = db.Column(db.String(60), nullable=False)
    filters = db.Column(db.JSON, nullable=False, default=dict)

    user = db.relationship("User", foreign_keys=[user_id])

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "filters": self.filters or {},
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
        }
