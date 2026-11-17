"""Company settings used by reports, exports and WhatsApp messages."""
from __future__ import annotations

from flask import Blueprint, g, jsonify

from ..extensions import db
from ..models import AuditAction, Setting
from ..services.audit import log_action
from ..utils.responses import json_body, validation_error
from ..utils.security import auth_required
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_email,
    parse_phone,
    parse_state,
    validate_document,
)
from ..models import Role

bp = Blueprint("settings", __name__, url_prefix="/api/settings")

COMPANY_KEYS = (
    "company_name",
    "company_document",
    "company_phone",
    "company_email",
    "company_address",
    "company_city",
    "company_state",
    "company_signature",
)

DEFAULTS = {
    "company_name": "FACTOR PRO",
    "company_document": "",
    "company_phone": "",
    "company_email": "",
    "company_address": "",
    "company_city": "",
    "company_state": "",
    "company_signature": "Atenciosamente,\nFACTOR PRO - Gestão Financeira Inteligente",
}


def get_company_settings() -> dict:
    stored = {setting.key: setting.value for setting in Setting.query.all()}
    return {**DEFAULTS, **{key: stored[key] for key in COMPANY_KEYS if key in stored}}


@bp.get("/company")
@auth_required()
def company():
    return jsonify({"settings": get_company_settings()})


@bp.put("/company")
@auth_required(Role.ADMIN)
def update_company():
    payload = json_body()
    errors: dict[str, str] = {}

    name = clean_text(payload.get("company_name"), 120)
    if not name or len(name) < 2:
        errors["company_name"] = "Informe o nome da empresa."

    document = None
    raw_document = (payload.get("company_document") or "").strip()
    if raw_document:
        try:
            document, _ = validate_document(raw_document, "company_document")
        except ValidationError as exc:
            errors.update(exc.errors)

    try:
        email = parse_email(payload.get("company_email"), "company_email")
    except ValidationError as exc:
        errors.update(exc.errors)
        email = None

    try:
        phone = parse_phone(payload.get("company_phone"), "company_phone")
    except ValidationError as exc:
        errors.update(exc.errors)
        phone = None

    try:
        state = parse_state(payload.get("company_state"), "company_state")
    except ValidationError as exc:
        errors.update(exc.errors)
        state = None

    if errors:
        raise ValidationError(errors)

    values = {
        "company_name": name,
        "company_document": document or "",
        "company_phone": phone or "",
        "company_email": email or "",
        "company_address": clean_text(payload.get("company_address"), 220) or "",
        "company_city": clean_text(payload.get("company_city"), 120) or "",
        "company_state": state or "",
        "company_signature": clean_text(payload.get("company_signature"), 500) or DEFAULTS["company_signature"],
    }

    before = get_company_settings()
    for key, value in values.items():
        setting = db.session.get(Setting, key)
        if not setting:
            setting = Setting(key=key)
            db.session.add(setting)
        setting.value = value
        setting.updated_by_id = g.current_user.id

    changes = {key: [before.get(key), value] for key, value in values.items() if before.get(key) != value}
    if changes:
        log_action(AuditAction.UPDATE, "settings", None, "Dados da empresa atualizados", changes)
    db.session.commit()
    return jsonify({"settings": get_company_settings(), "message": "Configurações salvas com sucesso."})
