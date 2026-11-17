"""Audit logging service."""
from __future__ import annotations

import json

from flask import g, has_request_context, request

from ..extensions import db
from ..models import AuditLog


def log_action(
    action: str,
    entity: str,
    entity_id: int | None = None,
    description: str | None = None,
    changes: dict | None = None,
    user=None,
    commit: bool = False,
):
    actor = user or g.get("current_user")
    ip_address = None
    if has_request_context():
        ip_address = (
            (request.headers.get("X-Forwarded-For", request.remote_addr or "") or "")
            .split(",")[0]
            .strip()[:64]
            or None
        )
    entry = AuditLog(
        user_id=getattr(actor, "id", None),
        user_email=getattr(actor, "email", None),
        action=action,
        entity=entity,
        entity_id=entity_id,
        description=(description or "")[:255] or None,
        changes=json.dumps(changes, ensure_ascii=False, default=str) if changes else None,
        ip_address=ip_address,
    )
    db.session.add(entry)
    if commit:
        db.session.commit()
    return entry


def diff_changes(before: dict, after: dict) -> dict:
    """Return {field: [old, new]} for fields that actually changed."""
    changes = {}
    for key, new_value in after.items():
        old_value = before.get(key)
        if isinstance(new_value, float) or isinstance(old_value, float):
            if old_value is None and new_value is None:
                continue
            if old_value is not None and new_value is not None and abs(float(old_value) - float(new_value)) < 0.005:
                continue
        if old_value != new_value:
            changes[key] = [old_value, new_value]
    return changes
