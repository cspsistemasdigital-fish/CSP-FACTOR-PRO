"""Company and brand settings (single source of truth).

Settings are stored as key/value rows so new options do not require a schema
migration. Reads always merge stored values over the defaults below: an
existing database therefore works even before ``flask seed`` is run again.

Brand settings (``app_name`` and the uploaded logo) are intentionally public:
they contain no personal data and must be available on the login screen and to
the browser when it installs/updates the PWA.
"""
from __future__ import annotations

from flask import current_app

from ..extensions import db
from ..models import Setting
from ..models.base import iso, utcnow
from ..utils.files import delete_attachment

APP_NAME_DEFAULT = "FACTOR PRO"
APP_NAME_MAX = 60

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

BRAND_KEYS = (
    "app_name",
    "logo_path",
    "logo_name",
    "logo_version",
)

DEFAULTS = {
    "app_name": APP_NAME_DEFAULT,
    "company_name": APP_NAME_DEFAULT,
    "company_document": "",
    "company_phone": "",
    "company_email": "",
    "company_address": "",
    "company_city": "",
    "company_state": "",
    "company_signature": "Atenciosamente,\nFACTOR PRO - Gestão Financeira Inteligente",
    "logo_path": "",
    "logo_name": "",
    "logo_version": "",
}

# Warmer, executive light palette (kept in sync with frontend/src/styles/app.css
# and frontend/index.html).
THEME_COLOR = "#123D32"
BACKGROUND_COLOR = "#F7F4EE"


def get_settings() -> dict:
    """All settings, with defaults applied for missing keys."""
    stored = {setting.key: setting.value for setting in Setting.query.all()}
    return {**DEFAULTS, **{key: stored[key] for key in DEFAULTS if key in stored}}


def get_company_settings() -> dict:
    settings = get_settings()
    company = {key: settings[key] for key in COMPANY_KEYS}
    # The institutional name falls back to the app name when unset.
    company["company_name"] = company["company_name"] or settings["app_name"] or APP_NAME_DEFAULT
    return company


def get_brand() -> dict:
    """Public payload used by the SPA, the login screen and the PWA manifest."""
    settings = get_settings()
    app_name = (settings["app_name"] or settings["company_name"] or APP_NAME_DEFAULT).strip()
    logo_path = settings["logo_path"] or ""
    version = settings["logo_version"] or ""
    return {
        "app_name": app_name,
        "short_name": app_name[:12],
        "logo_url": f"/brand/logo?v={version}" if logo_path else None,
        "logo_name": settings["logo_name"] or "",
        "logo_version": version,
        "theme_color": THEME_COLOR,
        "background_color": BACKGROUND_COLOR,
    }


def save_settings(values: dict, user_id: int | None) -> dict[str, list]:
    """Upsert settings rows and return a ``{key: [old, new]}`` changes mapping."""
    before = get_settings()
    changes: dict[str, list] = {}
    for key, value in values.items():
        if key not in DEFAULTS:
            continue
        value = "" if value is None else str(value)
        if before.get(key) == value:
            continue
        setting = db.session.get(Setting, key)
        if not setting:
            setting = Setting(key=key)
            db.session.add(setting)
        setting.value = value
        setting.updated_by_id = user_id
        changes[key] = [before.get(key), value]
    return changes


def remove_logo(user_id: int | None) -> dict[str, list]:
    """Delete the stored logo file and clear its settings (best effort on disk)."""
    settings = get_settings()
    path = settings["logo_path"]
    if path:
        folder = current_app.config["UPLOAD_FOLDER"]
        delete_attachment(folder, path)
    return save_settings(
        {"logo_path": "", "logo_name": "", "logo_version": ""}, user_id
    )


def settings_updated_at() -> str:
    return iso(utcnow())
