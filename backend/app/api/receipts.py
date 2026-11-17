"""Receipt (recebimento) endpoints."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from ..extensions import db
from ..models import DocumentKind, Receipt, Role
from ..services.receipts import (
    _apply_filters,
    build_recibo,
    create_receipt,
    estorno_receipt,
    list_totals,
    open_documents,
    receipt_history,
    serialize_receipt,
    update_receipt,
)
from ..utils.responses import error, json_body, paginated, pagination_args
from ..utils.security import auth_required
from ..utils.validators import ValidationError, parse_int
from .documents_utils import (
    download_attachment,
    remove_attachment,
    upload_attachment,
)

bp = Blueprint("receipts", __name__, url_prefix="/api/receipts")


def _get_or_none(receipt_id: int) -> Receipt | None:
    receipt = db.session.get(Receipt, receipt_id)
    if not receipt or receipt.is_deleted:
        return None
    return receipt


@bp.get("")
@auth_required()
def list_receipts():
    page, per_page = pagination_args()
    query = Receipt.query.filter(Receipt.is_deleted.is_(False))
    query = _apply_filters(query, request.args)
    total = query.count()
    totals = list_totals(query)
    items = query.offset((page - 1) * per_page).limit(per_page).all()
    return paginated(
        [serialize_receipt(receipt) for receipt in items],
        page,
        per_page,
        total,
        totals,
    )


@bp.get("/open-documents")
@auth_required()
def list_open_documents():
    client_id = request.args.get("client_id")
    kind = request.args.get("document_kind")
    if kind and kind not in DocumentKind.ALL:
        return error("Tipo de documento inválido.", 422)
    items = open_documents(
        client_id=int(client_id) if client_id and client_id.isdigit() else None,
        search=request.args.get("search"),
        kind=kind,
    )
    return jsonify({"items": items})


@bp.get("/<int:receipt_id>")
@auth_required()
def get_receipt(receipt_id: int):
    receipt = _get_or_none(receipt_id)
    if not receipt:
        return error("Recebimento não encontrado.", 404)
    return jsonify(
        {
            "item": serialize_receipt(receipt),
            "history": receipt_history(receipt),
        }
    )


@bp.get("/<int:receipt_id>/recibo")
@auth_required()
def get_recibo(receipt_id: int):
    receipt = _get_or_none(receipt_id)
    if not receipt:
        return error("Recebimento não encontrado.", 404)
    return jsonify({"item": build_recibo(receipt)})


@bp.post("")
@auth_required(Role.ADMIN, Role.OPERATOR)
def new_receipt():
    receipt, warnings = create_receipt(json_body(), g.current_user)
    return (
        jsonify(
            {
                "item": serialize_receipt(receipt),
                "warnings": warnings,
                "message": "Recebimento registrado com sucesso.",
            }
        ),
        201,
    )


@bp.put("/<int:receipt_id>")
@auth_required(Role.ADMIN, Role.OPERATOR)
def edit_receipt(receipt_id: int):
    receipt = _get_or_none(receipt_id)
    if not receipt:
        return error("Recebimento não encontrado.", 404)
    receipt, warnings = update_receipt(receipt, json_body(), g.current_user)
    return jsonify(
        {
            "item": serialize_receipt(receipt),
            "warnings": warnings,
            "message": "Recebimento atualizado com sucesso.",
        }
    )


@bp.delete("/<int:receipt_id>")
@auth_required(Role.ADMIN)
def remove_receipt(receipt_id: int):
    receipt = _get_or_none(receipt_id)
    if not receipt:
        return error("Recebimento não encontrado.", 404)
    estorno_receipt(receipt, g.current_user)
    return jsonify({"message": "Recebimento estornado com sucesso."})


@bp.post("/<int:receipt_id>/attachment")
@auth_required(Role.ADMIN, Role.OPERATOR)
def upload_receipt_attachment(receipt_id: int):
    receipt = _get_or_none(receipt_id)
    if not receipt:
        return error("Recebimento não encontrado.", 404)
    return upload_attachment(receipt, "receipt", g.current_user)


@bp.get("/<int:receipt_id>/attachment")
@auth_required()
def download_receipt_attachment(receipt_id: int):
    receipt = _get_or_none(receipt_id)
    if not receipt:
        return error("Recebimento não encontrado.", 404)
    return download_attachment(receipt)


@bp.delete("/<int:receipt_id>/attachment")
@auth_required(Role.ADMIN, Role.OPERATOR)
def remove_receipt_attachment(receipt_id: int):
    receipt = _get_or_none(receipt_id)
    if not receipt:
        return error("Recebimento não encontrado.", 404)
    return remove_attachment(receipt, "receipt", g.current_user)
