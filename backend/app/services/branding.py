"""Resolved branding assets shared by every export and printable view.

A single uploaded image is used as the application icon and as the company
logo. Missing or unreadable files never break an export: callers fall back to
text-only branding.
"""
from __future__ import annotations

from pathlib import Path

from flask import current_app

DEFAULT_NAME = "FACTOR PRO"


def brand_logo_path(company: dict | None) -> str | None:
    """Absolute path of the configured logo, or None when unavailable."""
    stored = (company or {}).get("brand_logo_path")
    if not stored:
        return None
    candidate = Path(current_app.config["UPLOAD_FOLDER"]) / stored
    return str(candidate) if candidate.is_file() else None


def company_display_name(company: dict | None) -> str:
    """Brand printed on exports: a customized app name wins; otherwise the company name."""
    company_data = company or {}
    app_name = (company_data.get("app_name") or "").strip()
    if app_name and app_name != DEFAULT_NAME:
        return app_name
    return (company_data.get("company_name") or "").strip() or app_name or DEFAULT_NAME


def app_display_name(company: dict | None) -> str:
    """Name used in the application shell, document metadata and footers."""
    company_data = company or {}
    return (company_data.get("app_name") or "").strip() or (company_data.get("company_name") or "").strip() or DEFAULT_NAME


def export_slug(company: dict | None) -> str:
    """Filesystem-safe brand slug for download filenames."""
    import re
    import unicodedata

    name = company_display_name(company)
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "relatorio"
