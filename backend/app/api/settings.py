"""Company settings, public brand payload and logo management."""
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from flask import Blueprint, current_app, g, jsonify, request

from ..extensions import db
from ..models import AuditAction, Role
from ..services.audit import log_action
from ..services.settings import (
    APP_NAME_MAX,
    DEFAULTS,
    get_brand,
    get_company_settings,
    get_settings,
    remove_logo,
    save_settings,
)
from ..utils.files import delete_attachment, save_attachment
from ..utils.responses import json_body
from ..utils.security import auth_required
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_email,
    parse_phone,
    parse_state,
    validate_document,
)

# Kept as a re-export so older imports (and tests) keep working.
__all__ = ["bp", "COMPANY_KEYS", "DEFAULTS", "get_company_settings", "get_brand"]

bp = Blueprint("settings", __name__, url_prefix="/api/settings")

COMPANY_KEYS = (
    "app_name",
    "company_name",
    "company_document",
    "company_phone",
    "company_email",
    "company_address",
    "company_city",
    "company_state",
    "company_signature",
)

# SVG is deliberately rejected: user-supplied SVG can execute script when
# displayed. PNG/JPEG/WebP cover the PWA icon use case safely.
LOGO_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}


@bp.get("/brand")
def brand():
    """Public identity used before login (branding + PWA install/update)."""
    return jsonify({"brand": get_brand()})


@bp.get("/company")
@auth_required()
def company():
    return jsonify({"settings": get_company_settings()})


@bp.put("/company")
@auth_required(Role.ADMIN)
def update_company():
    payload = json_body()
    errors: dict[str, str] = {}

    app_name = clean_text(payload.get("app_name"), APP_NAME_MAX)
    if not app_name or len(app_name) < 2:
        errors["app_name"] = f"Informe o nome do aplicativo (mínimo 2 caracteres, máximo {APP_NAME_MAX})."

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
        "app_name": app_name,
        "company_name": name,
        "company_document": document or "",
        "company_phone": phone or "",
        "company_email": email or "",
        "company_address": clean_text(payload.get("company_address"), 220) or "",
        "company_city": clean_text(payload.get("company_city"), 120) or "",
        "company_state": state or "",
        "company_signature": clean_text(payload.get("company_signature"), 500) or DEFAULTS["company_signature"],
    }

    changes = save_settings(values, g.current_user.id)
    if changes:
        log_action(AuditAction.UPDATE, "settings", None, "Dados da empresa atualizados", changes)
    db.session.commit()
    return jsonify({"settings": get_company_settings(), "brand": get_brand(), "message": "Configurações salvas com sucesso."})


@bp.post("/logo")
@auth_required(Role.ADMIN)
def upload_logo():
    """Upload the company logo used in the UI and as the installed PWA icon."""
    file = request.files.get("file") or request.files.get("logo")
    upload_folder = Path(current_app.config["UPLOAD_FOLDER"])
    brand_folder = upload_folder / "brand"
    brand_folder.mkdir(parents=True, exist_ok=True)

    try:
        saved = save_attachment(file, str(brand_folder), LOGO_EXTENSIONS)
    except ValidationError as exc:
        raise ValidationError({"logo": exc.errors.get("attachment", "Arquivo de logo inválido.")})

    old_path = get_settings()["logo_path"]
    changes = save_settings(
        {
            "logo_path": f"brand/{saved['path']}",
            "logo_name": saved["name"],
            "logo_version": uuid4().hex[:10],
        },
        g.current_user.id,
    )
    if old_path:
        delete_attachment(str(upload_folder), old_path)
    log_action(
        AuditAction.UPDATE,
        "settings",
        None,
        "Logotipo da empresa atualizado",
        changes={"logo_name": [None, saved["name"]]},
    )
    db.session.commit()
    return jsonify({"message": "Logotipo enviado com sucesso.", "brand": get_brand()})


@bp.delete("/logo")
@auth_required(Role.ADMIN)
def delete_logo():
    """Restore the built-in mark."""
    changes = remove_logo(g.current_user.id)
    if changes:
        log_action(AuditAction.UPDATE, "settings", None, "Logotipo da empresa removido", changes)
    db.session.commit()
    return jsonify({"message": "Logotipo removido. A marca padrão foi restaurada.", "brand": get_brand()})
