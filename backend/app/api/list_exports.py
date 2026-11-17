"""Excel export of the saved records shown on each list screen (Etapa 8)."""
from __future__ import annotations

from io import BytesIO

from flask import Blueprint, abort, g, jsonify, request, send_file

from ..models import AuditAction
from ..services.audit import log_action
from ..services.list_exports import (
    ADMIN_ONLY,
    RESOURCE_LABELS,
    build_rows,
    export_filename,
    render_list_xlsx,
)
from ..utils.security import auth_required
from .settings import get_company_settings

bp = Blueprint("list_exports", __name__, url_prefix="/api/export")

MIMETYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@bp.get("/<resource>/xlsx")
@auth_required()
def export_list_xlsx(resource: str):
    if resource not in RESOURCE_LABELS:
        abort(404)
    if resource in ADMIN_ONLY and not g.current_user.is_admin:
        abort(403)

    spec = build_rows(resource, request.args)
    if spec is None:  # pragma: no cover - guarded by RESOURCE_LABELS
        abort(404)

    company = get_company_settings()
    payload = render_list_xlsx(spec, RESOURCE_LABELS[resource], company)
    log_action(
        AuditAction.EXPORT,
        f"{resource}_list",
        None,
        f"Lista de {RESOURCE_LABELS[resource].lower()} exportada para Excel",
        changes={"rows": len(spec["rows"]), "format": "xlsx"},
        commit=True,
    )
    return send_file(
        BytesIO(payload),
        mimetype=MIMETYPE,
        as_attachment=True,
        download_name=export_filename(resource, company),
        max_age=0,
    )


@bp.get("/resources")
@auth_required()
def available_resources():
    """Labels used by the UI to render the export buttons."""
    items = [
        {"key": key, "label": label, "admin_only": key in ADMIN_ONLY}
        for key, label in RESOURCE_LABELS.items()
        if key not in ADMIN_ONLY or getattr(g.current_user, "is_admin", False)
    ]
    return jsonify({"items": items})
