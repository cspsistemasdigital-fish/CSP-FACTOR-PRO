"""Boleto endpoints."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy.orm import joinedload

from ..models import Boleto, DocumentStatus, Role
from ..services.documents import (
    _apply_filters,
    change_status,
    create_boleto,
    delete_document,
    list_totals,
    update_boleto,
)
from ..utils.responses import error, json_body, paginated, pagination_args
from ..utils.security import auth_required
from .documents_utils import (
    document_history,
    download_attachment,
    get_document_or_none,
    list_banks,
    remove_attachment,
    upload_attachment,
)

bp = Blueprint("boletos", __name__, url_prefix="/api/boletos")


@bp.get("")
@auth_required()
def list_boletos():
    page, per_page = pagination_args()
    query = Boleto.query.filter(Boleto.is_deleted.is_(False))
    query = _apply_filters(query, Boleto, request.args, "boleto")
    total = query.count()
    totals = list_totals(query, Boleto, "boleto")
    items = (
        query.options(joinedload(Boleto.client))
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return paginated([item.to_dict() for item in items], page, per_page, total, totals)


@bp.get("/banks")
@auth_required()
def banks():
    return jsonify({"items": list_banks(Boleto)})


@bp.get("/<int:boleto_id>")
@auth_required()
def get_boleto(boleto_id: int):
    boleto = get_document_or_none(Boleto, boleto_id)
    if not boleto:
        return error("Boleto não encontrado.", 404)
    return jsonify({"item": boleto.to_dict(), "history": document_history("boleto", boleto.id)})


@bp.post("")
@auth_required(Role.ADMIN, Role.OPERATOR)
def new_boleto():
    boleto, warnings = create_boleto(json_body(), g.current_user)
    return (
        jsonify(
            {
                "item": boleto.to_dict(),
                "warnings": warnings,
                "message": "Boleto cadastrado com sucesso.",
            }
        ),
        201,
    )


@bp.put("/<int:boleto_id>")
@auth_required(Role.ADMIN, Role.OPERATOR)
def edit_boleto(boleto_id: int):
    boleto = get_document_or_none(Boleto, boleto_id)
    if not boleto:
        return error("Boleto não encontrado.", 404)
    boleto, warnings = update_boleto(boleto, json_body(), g.current_user)
    return jsonify(
        {
            "item": boleto.to_dict(),
            "warnings": warnings,
            "message": "Boleto atualizado com sucesso.",
        }
    )


@bp.patch("/<int:boleto_id>/status")
@auth_required(Role.ADMIN, Role.OPERATOR)
def set_boleto_status(boleto_id: int):
    boleto = get_document_or_none(Boleto, boleto_id)
    if not boleto:
        return error("Boleto não encontrado.", 404)
    payload = json_body()
    change_status(boleto, payload.get("status"), g.current_user)
    return jsonify(
        {
            "item": boleto.to_dict(),
            "statuses": [
                {"value": status, "label": DocumentStatus.LABELS[status]} for status in DocumentStatus.ALL
            ],
            "message": "Status atualizado.",
        }
    )


@bp.delete("/<int:boleto_id>")
@auth_required(Role.ADMIN)
def remove_boleto(boleto_id: int):
    boleto = get_document_or_none(Boleto, boleto_id)
    if not boleto:
        return error("Boleto não encontrado.", 404)
    delete_document(boleto, g.current_user)
    return jsonify({"message": "Boleto excluído com sucesso."})


@bp.post("/<int:boleto_id>/attachment")
@auth_required(Role.ADMIN, Role.OPERATOR)
def upload_boleto_attachment(boleto_id: int):
    boleto = get_document_or_none(Boleto, boleto_id)
    if not boleto:
        return error("Boleto não encontrado.", 404)
    return upload_attachment(boleto, "boleto", g.current_user)


@bp.get("/<int:boleto_id>/attachment")
@auth_required()
def download_boleto_attachment(boleto_id: int):
    boleto = get_document_or_none(Boleto, boleto_id)
    if not boleto:
        return error("Boleto não encontrado.", 404)
    return download_attachment(boleto)


@bp.delete("/<int:boleto_id>/attachment")
@auth_required(Role.ADMIN, Role.OPERATOR)
def delete_boleto_attachment(boleto_id: int):
    boleto = get_document_or_none(Boleto, boleto_id)
    if not boleto:
        return error("Boleto não encontrado.", 404)
    return remove_attachment(boleto, "boleto", g.current_user)
