"""User model and role definitions."""
from __future__ import annotations

from datetime import datetime

from flask import current_app
from werkzeug.security import check_password_hash, generate_password_hash

from ..extensions import db
from .base import TimestampMixin, iso


class Role:
    ADMIN = "ADMIN"
    OPERATOR = "OPERATOR"
    VIEWER = "VIEWER"

    ALL = (ADMIN, OPERATOR, VIEWER)
    LABELS = {
        ADMIN: "Administrador",
        OPERATOR: "Operador",
        VIEWER: "Consultor / Visualizador",
    }


class User(TimestampMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(160), nullable=False, unique=True, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default=Role.OPERATOR)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    must_change_password = db.Column(db.Boolean, nullable=False, default=False)
    last_login_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # --- Password helpers -------------------------------------------------
    def set_password(self, raw_password: str) -> None:
        method = "pbkdf2:sha256:600000"
        try:
            method = current_app.config.get("PASSWORD_HASH_METHOD", method)
        except RuntimeError:  # outside application context
            pass
        self.password_hash = generate_password_hash(raw_password, method=method)

    def check_password(self, raw_password: str) -> bool:
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, raw_password)

    @property
    def role_label(self) -> str:
        return Role.LABELS.get(self.role, self.role)

    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN

    def to_dict(self, include_email: bool = True) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "role_label": self.role_label,
            "is_active": self.is_active,
            "must_change_password": self.must_change_password,
            "last_login_at": iso(self.last_login_at),
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
        }
        if include_email:
            data["email"] = self.email
        return data

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.email} ({self.role})>"
