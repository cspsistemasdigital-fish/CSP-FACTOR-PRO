"""Company settings, application branding and their public read-only view."""
from __future__ import annotations

import json
import mimetypes
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

from flask import Blueprint, Response, current_app, g, jsonify, request, send_file

from ..extensions import db
from ..models import AuditAction, Setting
from ..services.audit import log_action
from ..services.backup import (
    BACKUP_DEFAULTS,
    create_backup,
    delete_backup,
    get_backup_config,
    list_backups,
)
from ..utils.files import delete_attachment, save_attachment
from ..utils.responses import error, json_body
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

# A single image is reused as the app icon (favicon, menu) and as the company
# logo in PDF/XLSX exports, receipts and duplicatas — user decision (Etapa 7).
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

COMPANY_KEYS = (
    "company_name",
    "company_document",
    "company_phone",
    "company_email",
    "company_address",
    "company_city",
    "company_state",
    "company_signature",
    "app_name",
    "brand_logo_path",
    "brand_logo_name",
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
    "app_name": "FACTOR PRO",
    "brand_logo_path": "",
    "brand_logo_name": "",
    **BACKUP_DEFAULTS,
}


def get_company_settings() -> dict:
    stored = {setting.key: setting.value for setting in Setting.query.all()}
    return {**DEFAULTS, **{key: stored[key] for key in COMPANY_KEYS if key in stored}}


def _set_setting(key: str, value) -> None:
    setting = db.session.get(Setting, key)
    if not setting:
        setting = Setting(key=key)
        db.session.add(setting)
    setting.value = value or ""
    setting.updated_by_id = g.current_user.id


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

    app_name = clean_text(payload.get("app_name"), 60)
    if not app_name or len(app_name) < 2:
        errors["app_name"] = "Informe o nome do aplicativo."

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
        "app_name": app_name,
    }

    before = get_company_settings()
    for key, value in values.items():
        _set_setting(key, value)

    changes = {key: [before.get(key), value] for key, value in values.items() if before.get(key) != value}
    if changes:
        log_action(AuditAction.UPDATE, "settings", None, "Dados da empresa atualizados", changes)
    db.session.commit()
    return jsonify({"settings": get_company_settings(), "message": "Configurações salvas com sucesso."})


@bp.post("/company/logo")
@auth_required(Role.ADMIN)
def upload_logo():
    """Store the single branding image used by the UI and every export."""
    saved = save_attachment(request.files.get("file"), current_app.config["UPLOAD_FOLDER"], IMAGE_EXTENSIONS)
    before = get_company_settings()
    previous = before.get("brand_logo_path")
    _set_setting("brand_logo_path", saved["path"])
    _set_setting("brand_logo_name", saved["name"])
    if previous and previous != saved["path"]:
        delete_attachment(current_app.config["UPLOAD_FOLDER"], previous)
    log_action(
        AuditAction.UPDATE,
        "settings",
        None,
        "Logotipo do aplicativo atualizado",
        {"brand_logo_name": [before.get("brand_logo_name"), saved["name"]]},
    )
    db.session.commit()
    return jsonify({"settings": get_company_settings(), "message": "Logotipo atualizado."}), 201


@bp.delete("/company/logo")
@auth_required(Role.ADMIN)
def remove_logo():
    before = get_company_settings()
    previous = before.get("brand_logo_path")
    if previous:
        delete_attachment(current_app.config["UPLOAD_FOLDER"], previous)
    _set_setting("brand_logo_path", "")
    _set_setting("brand_logo_name", "")
    log_action(
        AuditAction.UPDATE,
        "settings",
        None,
        "Logotipo do aplicativo removido",
        {"brand_logo_name": [before.get("brand_logo_name"), ""]},
    )
    db.session.commit()
    return jsonify({"settings": get_company_settings(), "message": "Logotipo removido."})


@bp.get("/brand")
def public_brand():
    """Minimal, non-secret branding for the login screen, favicon and PWA.

    The full company payload (document, address, e-mail) remains authenticated.
    """
    settings = get_company_settings()
    has_logo = bool(settings.get("brand_logo_path"))
    return jsonify(
        {
            "app_name": settings.get("app_name") or DEFAULTS["app_name"],
            "company_name": settings.get("company_name") or DEFAULTS["company_name"],
            "has_logo": has_logo,
            "logo_url": "/api/settings/brand/logo" if has_logo else None,
        }
    )


@bp.get("/brand/logo")
def brand_logo():
    stored = get_company_settings().get("brand_logo_path")
    if not stored:
        return error("Logotipo não configurado.", 404, {"logo": "Logotipo não configurado."})
    path = Path(current_app.config["UPLOAD_FOLDER"]) / stored
    if not path.is_file():
        return error("Logotipo não encontrado.", 404, {"logo": "Logotipo não encontrado."})
    mimetype = mimetypes.guess_type(stored)[0] or "image/png"
    return send_file(path, mimetype=mimetype, max_age=0)


@bp.get("/brand/favicon")
def brand_favicon():
    """Public favicon: the uploaded logo, or an SVG generated from the app name."""
    stored = get_company_settings().get("brand_logo_path")
    if stored:
        path = Path(current_app.config["UPLOAD_FOLDER"]) / stored
        if path.is_file():
            mimetype = mimetypes.guess_type(stored)[0] or "image/png"
            return send_file(path, mimetype=mimetype, max_age=0)
    name = get_company_settings().get("app_name") or DEFAULTS["app_name"]
    initial = xml_escape((name.strip()[:1] or "F").upper())
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="14" fill="#123D32"/>'
        '<text x="32" y="43" font-family="Arial,sans-serif" font-size="34" '
        f'font-weight="bold" fill="#FFFFFF" text-anchor="middle">{initial}</text>'
        "</svg>"
    )
    return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "no-cache"})


@bp.get("/brand/manifest.webmanifest")
def brand_manifest():
    """Public PWA manifest generated from the current branding settings."""
    settings = get_company_settings()
    name = settings.get("app_name") or DEFAULTS["app_name"]
    has_logo = bool(settings.get("brand_logo_path"))
    icons = [
        {
            "src": "/api/settings/brand/favicon" if has_logo else "/favicon.svg",
            "sizes": "any" if has_logo else "192x192",
            "type": "image/png" if has_logo else "image/svg+xml",
            "purpose": "any",
        },
        {"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {
            "src": "/icons/icon-maskable-512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "maskable",
        },
    ]
    manifest = {
        "name": f"{name} — Gestão Financeira Inteligente",
        "short_name": name[:30],
        "description": (
            f"Gestão financeira inteligente de cheques, boletos e operações de factoring — {name}."
        ),
        "lang": "pt-BR",
        "dir": "ltr",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "display_override": ["window-controls-overlay", "standalone", "minimal-ui"],
        "background_color": "#F4F7F6",
        "theme_color": "#123D32",
        "orientation": "any",
        "categories": ["finance", "business", "productivity"],
        "icons": icons,
        "shortcuts": [
            {"name": "Dashboard", "short_name": "Dashboard", "url": "/"},
            {"name": "Clientes", "short_name": "Clientes", "url": "/clientes"},
            {"name": "Relatórios", "short_name": "Relatórios", "url": "/relatorios"},
        ],
    }
    return Response(
        json.dumps(manifest, ensure_ascii=False),
        mimetype="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# Daily safety backup (Etapa 8)
# ---------------------------------------------------------------------------

def _backup_bool(value, field: str, errors: dict, default: bool = True) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    errors[field] = "Informe um valor válido (sim ou não)."
    return default


@bp.get("/backup")
@auth_required()
def backup_status():
    """Current backup preferences plus the stored backup files."""
    return jsonify(
        {
            "settings": get_backup_config(),
            "backups": list_backups(),
            "scheduler_enabled": bool(current_app.config.get("BACKUP_SCHEDULER_ENABLED", True)),
        }
    )


@bp.put("/backup")
@auth_required(Role.ADMIN)
def update_backup():
    payload = json_body()
    errors: dict[str, str] = {}

    enabled = _backup_bool(payload.get("backup_enabled"), "backup_enabled", errors)
    include_uploads = _backup_bool(
        payload.get("backup_include_uploads"), "backup_include_uploads", errors
    )

    time_value = clean_text(payload.get("backup_time"), 5) or "03:00"
    try:
        hour, minute = (part.strip() for part in time_value.split(":", 1))
        parsed_time = f"{int(hour):02d}:{int(minute):02d}"
        if not (0 <= int(hour) <= 23 and 0 <= int(minute) <= 59):
            raise ValueError("fora da faixa")
    except (TypeError, ValueError):
        errors["backup_time"] = "Informe um horário válido (HH:MM)."
        parsed_time = "03:00"

    try:
        retention = int(payload.get("backup_retention_days", "7"))
        if not 1 <= retention <= 365:
            raise ValueError("fora da faixa")
    except (TypeError, ValueError):
        errors["backup_retention_days"] = "Informe de 1 a 365 dias."
        retention = 7

    if errors:
        raise ValidationError(errors)

    values = {
        "backup_enabled": "true" if enabled else "false",
        "backup_time": parsed_time,
        "backup_retention_days": str(retention),
        "backup_include_uploads": "true" if include_uploads else "false",
    }
    before = get_backup_config()
    for key, value in values.items():
        _set_setting(key, value)

    changes = {key: [before.get(key), value] for key, value in values.items() if before.get(key) != value}
    if changes:
        log_action(AuditAction.UPDATE, "settings", None, "Backup diário configurado", changes)
    db.session.commit()
    return jsonify(
        {
            "settings": get_backup_config(),
            "backups": list_backups(),
            "message": "Configuração do backup salva com sucesso.",
        }
    )


@bp.post("/backup/run")
@auth_required(Role.ADMIN)
def run_backup_now():
    """Create a backup immediately, independent of the daily schedule."""
    try:
        result = create_backup()
    except Exception as exc:  # pragma: no cover - depends on the database engine
        current_app.logger.exception("Falha no backup manual")
        return error(f"Não foi possível criar o backup: {exc}", 500)

    _set_setting("backup_last_at", datetime.now().isoformat(timespec="seconds"))
    _set_setting("backup_last_error", "")
    log_action(AuditAction.CREATE, "backup", None, f"Backup manual criado: {result['name']}")
    db.session.commit()
    return jsonify(
        {
            "item": result,
            "backups": list_backups(),
            "message": "Backup criado com sucesso.",
        }
    )


@bp.get("/backup/<name>/download")
@auth_required(Role.ADMIN)
def download_backup(name: str):
    folder = Path(current_app.config["BACKUP_FOLDER"]).resolve()
    candidate = (folder / name).resolve()
    if candidate.parent != folder or not candidate.is_file() or candidate.suffix != ".zip":
        return error("Backup não encontrado.", 404)
    return send_file(candidate, as_attachment=True, download_name=name, max_age=0)


@bp.delete("/backup/<name>")
@auth_required(Role.ADMIN)
def remove_backup(name: str):
    if not delete_backup(name):
        return error("Backup não encontrado.", 404)
    log_action(AuditAction.DELETE, "backup", None, f"Backup removido: {name}")
    db.session.commit()
    return jsonify({"backups": list_backups(), "message": "Backup removido."})
