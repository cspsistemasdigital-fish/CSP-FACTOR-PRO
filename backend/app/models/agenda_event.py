"""Shared calendar events."""
from __future__ import annotations

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso


class AgendaEvent(TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "agenda_events"
    __table_args__ = (
        db.Index("ix_agenda_events_period", "start_at", "end_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(160), nullable=False)
    start_at = db.Column(db.DateTime(timezone=False), nullable=False, index=True)
    end_at = db.Column(db.DateTime(timezone=False), nullable=False)
    location = db.Column(db.String(180), nullable=True)
    description = db.Column(db.Text, nullable=True)
    color = db.Column(db.String(20), nullable=False, default="green")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "start_at": iso(self.start_at),
            "end_at": iso(self.end_at),
            "location": self.location,
            "description": self.description,
            "color": self.color,
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
            "created_by": self.created_by.name if self.created_by else None,
            "updated_by": self.updated_by.name if self.updated_by else None,
        }
