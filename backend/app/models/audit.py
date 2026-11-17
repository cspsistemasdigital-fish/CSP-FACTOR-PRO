"""Audit trail for every relevant change in the system."""
from __future__ import annotations

import json

from ..extensions import db
from .base import iso, utcnow


class AuditAction:
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    LOGIN = "LOGIN"
    LOGIN_FAILED = "LOGIN_FAILED"
    LOGOUT = "LOGOUT"
    STATUS_CHANGE = "STATUS_CHANGE"
    PASSWORD_CHANGE = "PASSWORD_CHANGE"
    PASSWORD_RESET = "PASSWORD_RESET"
    EXPORT = "EXPORT"


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    user_email = db.Column(db.String(160), nullable=True)
    action = db.Column(db.String(30), nullable=False, index=True)
    entity = db.Column(db.String(60), nullable=False, index=True)
    entity_id = db.Column(db.Integer, nullable=True, index=True)
    description = db.Column(db.String(255), nullable=True)
    changes = db.Column(db.Text, nullable=True)  # JSON string
    ip_address = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    user = db.relationship("User")

    def to_dict(self) -> dict:
        try:
            changes = json.loads(self.changes) if self.changes else None
        except (TypeError, ValueError):
            changes = None
        return {
            "id": self.id,
            "user_id": self.user_id,
            "user": self.user.name if self.user else self.user_email,
            "action": self.action,
            "entity": self.entity,
            "entity_id": self.entity_id,
            "description": self.description,
            "changes": changes,
            "ip_address": self.ip_address,
            "created_at": iso(self.created_at),
        }
