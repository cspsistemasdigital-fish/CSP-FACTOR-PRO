"""Report endpoints: JSON summary, WhatsApp text and PDF/XLSX exports."""
from __future__ import annotations

from io import BytesIO

from flask import Blueprint, current_app, g, jsonify, request, send_file

from ..services.reports import (
    audit_export,
    build_report,
    build_whatsapp,
    export_filename,
    parse_report_filters,
    render_pdf,
    render_xlsx,
)
from ..services.report_filters import (
    create_filter,
    delete_filter,
    list_filters,
    normalize_saved_filters,
    validate_filter_name,
)
from ..utils.responses import error, json_body
from ..utils.security import auth_required
from ..utils.validators import ValidationError, parse_int

bp = Blueprint("reports", __name__, url_prefix="/api/reports")


@bp.get("/summary")
@auth_required()
def summary():
    filters = parse_report_filters(request.args)
    return jsonify(build_report(filters))


@bp.get("/whatsapp")
@auth_required()
def whatsapp():
    filters = parse_report_filters(request.args)
    client_id = parse_int(request.args.get("client_id"), "client_id", required=True, minimum=1)
    return jsonify({"item": build_whatsapp(client_id, filters)})


@bp.get("/filters")
@auth_required()
def saved_filters():
    return jsonify({"items": [record.to_dict() for record in list_filters(g.current_user)]})


@bp.post("/filters")
@auth_required()
def save_filter():
    payload = json_body()
    name = validate_filter_name(payload.get("name"))
    filters = normalize_saved_filters(payload.get("filters") or {})
    record = create_filter(g.current_user, name, filters)
    return jsonify({"item": record.to_dict()}), 201


@bp.delete("/filters/<int:filter_id>")
@auth_required()
def remove_saved_filter(filter_id: int):
    if not delete_filter(g.current_user, filter_id):
        return error("Filtro não encontrado.", 404)
    return jsonify({"message": "Filtro removido."})


def _company() -> dict:
    from ..services.settings import get_company_settings

    return get_company_settings()


@bp.get("/export/pdf")
@auth_required()
def export_pdf():
    filters = parse_report_filters(request.args)
    report = build_report(filters)
    try:
        payload = render_pdf(report, _company(), g.current_user)
    except Exception:  # pragma: no cover - reported to the user, logged for diagnosis
        current_app.logger.exception("Falha ao gerar PDF do relatório")
        return error("Não foi possível gerar o PDF do relatório. Tente novamente.", 500)
    audit_export(g.current_user, "pdf", report)
    return send_file(
        BytesIO(payload),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=export_filename("pdf"),
        max_age=0,
    )


@bp.get("/export/xlsx")
@auth_required()
def export_xlsx():
    filters = parse_report_filters(request.args)
    report = build_report(filters)
    try:
        payload = render_xlsx(report, _company())
    except Exception:  # pragma: no cover - reported to the user, logged for diagnosis
        current_app.logger.exception("Falha ao gerar planilha do relatório")
        return error("Não foi possível gerar a planilha do relatório. Tente novamente.", 500)
    audit_export(g.current_user, "xlsx", report)
    return send_file(
        BytesIO(payload),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=export_filename("xlsx"),
        max_age=0,
    )
