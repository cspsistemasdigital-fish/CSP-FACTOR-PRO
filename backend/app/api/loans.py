"""Empréstimos: CRUD, parcelas e relatório (filtros, exportações e compartilhamento)."""
from __future__ import annotations

from datetime import datetime
from io import BytesIO

from flask import Blueprint, current_app, g, jsonify, request, send_file

from ..extensions import db
from ..models import AuditAction, DocumentStatus, Installment, Loan, Role
from ..services.audit import log_action
from ..services.email import mail_is_configured, send_text_email
from ..services.loans import (
    _apply_filters,
    change_loan_status,
    create_loan,
    delete_loan,
    list_totals,
    loan_history,
    serialize_loan,
    update_loan,
)
from ..services.loans_report import (
    audit_export,
    build_email,
    build_report,
    build_whatsapp,
    export_filename,
    filters_as_dict,
    parse_loan_filters,
    render_pdf,
    render_xlsx,
)
from ..api.settings import get_company_settings
from ..utils.responses import error, json_body, paginated, pagination_args
from ..utils.security import auth_required
from ..utils.validators import ValidationError, clean_text, parse_email, parse_int

bp = Blueprint("loans", __name__, url_prefix="/api/loans")


def _get_or_none(loan_id: int) -> Loan | None:
    loan = db.session.get(Loan, loan_id)
    if not loan or loan.is_deleted:
        return None
    return loan


def _report_filters():
    try:
        return parse_loan_filters(request.args), None
    except ValidationError as exc:
        return None, (jsonify({"message": exc.message, "errors": exc.errors}), 422)


@bp.get("")
@auth_required()
def list_loans():
    page, per_page = pagination_args()
    query = Loan.query.filter(Loan.is_deleted.is_(False))
    query = _apply_filters(query, request.args)
    total = query.count()
    totals = list_totals(query)
    items = query.offset((page - 1) * per_page).limit(per_page).all()
    return paginated(
        [serialize_loan(loan, include_items=False) for loan in items],
        page,
        per_page,
        total,
        totals,
    )


@bp.get("/report/summary")
@auth_required()
def report_summary():
    filters, failure = _report_filters()
    if failure:
        return failure
    return jsonify(build_report(filters))


@bp.get("/report/export/pdf")
@auth_required()
def report_pdf():
    filters, failure = _report_filters()
    if failure:
        return failure
    try:
        payload = render_pdf(build_report(filters), get_company_settings(), g.current_user)
        audit_export(g.current_user, "pdf", filters)
        return send_file(
            BytesIO(payload),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=export_filename("pdf"),
            max_age=0,
        )
    except Exception:
        current_app.logger.exception("Falha ao gerar PDF de empréstimos")
        return error("Não foi possível gerar o PDF do relatório.", 500)


@bp.get("/report/export/xlsx")
@auth_required()
def report_xlsx():
    filters, failure = _report_filters()
    if failure:
        return failure
    try:
        payload = render_xlsx(build_report(filters), get_company_settings())
        audit_export(g.current_user, "xlsx", filters)
        return send_file(
            BytesIO(payload),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=export_filename("xlsx"),
            max_age=0,
        )
    except Exception:
        current_app.logger.exception("Falha ao gerar planilha de empréstimos")
        return error("Não foi possível gerar a planilha do relatório.", 500)


@bp.get("/report/whatsapp")
@auth_required()
def report_whatsapp():
    filters, failure = _report_filters()
    if failure:
        return failure
    try:
        client_id = parse_int(request.args.get("client_id"), "client_id", required=True, minimum=1)
    except ValidationError as exc:
        return jsonify({"message": exc.message, "errors": exc.errors}), 422
    try:
        return jsonify({"item": build_whatsapp(client_id, filters)})
    except ValidationError as exc:
        return jsonify({"message": exc.message, "errors": exc.errors}), 422


@bp.post("/report/email")
@auth_required()
def report_email():
    payload = json_body()
    try:
        to_email = parse_email(payload.get("to"), "to", required=True)
    except ValidationError as exc:
        return jsonify({"message": exc.message, "errors": exc.errors}), 422
    filters, failure = _report_filters()
    if failure:
        return failure
    prepared = build_email(filters)
    message = clean_text(payload.get("message"), 8000) or prepared["body"]
    email_sent = False
    if mail_is_configured():
        try:
            email_sent = send_text_email(to_email, prepared["subject"], message)
        except Exception:
            current_app.logger.exception("Falha ao enviar relatório de empréstimos por e-mail")
    log_action(
        AuditAction.EXPORT,
        "loan_report_email",
        None,
        f"Relatório de empréstimos enviado por e-mail para {to_email}",
        changes={"to": to_email, "sent": email_sent, "filters": filters_as_dict(filters)},
        commit=True,
    )
    return jsonify(
        {
            "message": (
                "Relatório enviado por e-mail."
                if email_sent
                else "E-mail não configurado ou não enviado. O texto está disponível para conferência."
            ),
            "email_sent": email_sent,
            "subject": prepared["subject"],
            "preview": message,
        }
    )


@bp.get("/<int:loan_id>")
@auth_required()
def get_loan(loan_id: int):
    loan = _get_or_none(loan_id)
    if not loan:
        return error("Empréstimo não encontrado.", 404)
    return jsonify({"item": serialize_loan(loan), "history": loan_history(loan)})


@bp.get("/<int:loan_id>/duplicata")
@auth_required()
def duplicata(loan_id: int):
    """Dados completos para o documento de duplicata (sem gravar nada)."""
    loan = _get_or_none(loan_id)
    if not loan:
        return error("Empréstimo não encontrado.", 404)
    return jsonify(
        {
            "item": serialize_loan(loan),
            "company": get_company_settings(),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }
    )


@bp.post("")
@auth_required(Role.ADMIN, Role.OPERATOR)
def new_loan():
    loan, warnings = create_loan(json_body(), g.current_user)
    return (
        jsonify(
            {
                "item": serialize_loan(loan, warnings=warnings),
                "warnings": warnings,
                "message": "Empréstimo registrado com sucesso.",
            }
        ),
        201,
    )


@bp.put("/<int:loan_id>")
@auth_required(Role.ADMIN, Role.OPERATOR)
def edit_loan(loan_id: int):
    loan = _get_or_none(loan_id)
    if not loan:
        return error("Empréstimo não encontrado.", 404)
    loan, warnings = update_loan(loan, json_body(), g.current_user)
    return jsonify(
        {
            "item": serialize_loan(loan, warnings=warnings),
            "warnings": warnings,
            "message": "Empréstimo atualizado com sucesso.",
        }
    )


@bp.patch("/<int:loan_id>/status")
@auth_required(Role.ADMIN, Role.OPERATOR)
def change_status(loan_id: int):
    loan = _get_or_none(loan_id)
    if not loan:
        return error("Empréstimo não encontrado.", 404)
    payload = json_body()
    change_loan_status(loan, payload.get("status"), g.current_user)
    return jsonify(
        {
            "item": serialize_loan(loan),
            "message": f"Situação do empréstimo alterada para {loan.status_label}.",
        }
    )


@bp.patch("/<int:loan_id>/installments/<int:installment_id>/status")
@auth_required(Role.ADMIN, Role.OPERATOR)
def change_installment_status(loan_id: int, installment_id: int):
    loan = _get_or_none(loan_id)
    if not loan:
        return error("Empréstimo não encontrado.", 404)
    item = db.session.get(Installment, installment_id)
    if not item or item.is_deleted or item.loan_id != loan.id:
        return error("Parcela não encontrada.", 404)
    payload = json_body()
    status = (payload.get("status") or "").strip().upper()
    if status not in DocumentStatus.ALL:
        return jsonify({"message": "Situação inválida.", "errors": {"status": "Situação inválida."}}), 422
    item.status = status
    item.updated_by_id = g.current_user.id
    log_action(
        AuditAction.STATUS_CHANGE,
        "installment",
        item.id,
        f"Parcela {item.number} do empréstimo {loan.code}: situação alterada para {DocumentStatus.LABELS[status]}",
        changes={"status": status},
    )
    db.session.commit()
    return jsonify({"item": serialize_loan(loan), "message": "Situação da parcela atualizada."})


@bp.delete("/<int:loan_id>")
@auth_required(Role.ADMIN)
def remove_loan(loan_id: int):
    loan = _get_or_none(loan_id)
    if not loan:
        return error("Empréstimo não encontrado.", 404)
    delete_loan(loan, g.current_user)
    return jsonify({"message": "Empréstimo excluído com sucesso."})
