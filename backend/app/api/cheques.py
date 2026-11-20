"""Cheque endpoints."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models import Cheque, DocumentStatus, Role
from ..services.documents import (
    _apply_filters,
    change_status,
    create_cheque,
    delete_document,
    list_totals,
    update_cheque,
)
from ..utils.responses import error, json_body, paginated, pagination_args
from ..utils.security import auth_required
from .documents_utils import (
    document_history,
    download_attachment,
    download_photo,
    get_document_or_none,
    get_photo_or_none,
    list_banks,
    list_photos,
    remove_attachment,
    remove_photo,
    upload_attachment,
    upload_photos,
)

bp = Blueprint("cheques", __name__, url_prefix="/api/cheques")


@bp.get("")
@auth_required()
def list_cheques():
    page, per_page = pagination_args()
    query = Cheque.query.filter(Cheque.is_deleted.is_(False))
    query = _apply_filters(query, Cheque, request.args, "cheque")
    total = query.count()
    totals = list_totals(query, Cheque, "cheque")
    items = (
        query.options(joinedload(Cheque.client))
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return paginated([item.to_dict() for item in items], page, per_page, total, totals)


@bp.get("/banks")
@auth_required()
def banks():
    return jsonify({"items": list_banks(Cheque)})


@bp.get("/<int:cheque_id>")
@auth_required()
def get_cheque(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    return jsonify({"item": cheque.to_dict(), "history": document_history("cheque", cheque.id)})


@bp.post("")
@auth_required(Role.ADMIN, Role.OPERATOR)
def new_cheque():
    cheque, warnings = create_cheque(json_body(), g.current_user)
    return (
        jsonify(
            {
                "item": cheque.to_dict(),
                "warnings": warnings,
                "message": "Cheque cadastrado com sucesso.",
            }
        ),
        201,
    )


@bp.put("/<int:cheque_id>")
@auth_required(Role.ADMIN, Role.OPERATOR)
def edit_cheque(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    cheque, warnings = update_cheque(cheque, json_body(), g.current_user)
    return jsonify(
        {
            "item": cheque.to_dict(),
            "warnings": warnings,
            "message": "Cheque atualizado com sucesso.",
        }
    )


@bp.patch("/<int:cheque_id>/status")
@auth_required(Role.ADMIN, Role.OPERATOR)
def set_cheque_status(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    payload = json_body()
    change_status(cheque, payload.get("status"), g.current_user)
    return jsonify(
        {
            "item": cheque.to_dict(),
            "statuses": [
                {"value": status, "label": DocumentStatus.LABELS[status]} for status in DocumentStatus.ALL
            ],
            "message": "Status atualizado.",
        }
    )


@bp.delete("/<int:cheque_id>")
@auth_required(Role.ADMIN)
def remove_cheque(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    delete_document(cheque, g.current_user)
    return jsonify({"message": "Cheque excluído com sucesso."})


@bp.post("/<int:cheque_id>/attachment")
@auth_required(Role.ADMIN, Role.OPERATOR)
def upload_cheque_attachment(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    return upload_attachment(cheque, "cheque", g.current_user)


@bp.get("/<int:cheque_id>/attachment")
@auth_required()
def download_cheque_attachment(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    return download_attachment(cheque)


@bp.delete("/<int:cheque_id>/attachment")
@auth_required(Role.ADMIN, Role.OPERATOR)
def delete_cheque_attachment(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    return remove_attachment(cheque, "cheque", g.current_user)


@bp.get("/<int:cheque_id>/photos")
@auth_required()
def list_cheque_photos(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    return list_photos(cheque, "CHEQUE")


@bp.post("/<int:cheque_id>/photos")
@auth_required(Role.ADMIN, Role.OPERATOR)
def upload_cheque_photos(cheque_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    return upload_photos(cheque, "CHEQUE", "cheque", g.current_user)


@bp.get("/<int:cheque_id>/photos/<int:attachment_id>")
@auth_required()
def download_cheque_photo(cheque_id: int, attachment_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    photo = get_photo_or_none(cheque, "CHEQUE", attachment_id)
    if not photo:
        return error("Foto não encontrada.", 404)
    return download_photo(cheque, photo)


@bp.delete("/<int:cheque_id>/photos/<int:attachment_id>")
@auth_required(Role.ADMIN, Role.OPERATOR)
def delete_cheque_photo(cheque_id: int, attachment_id: int):
    cheque = get_document_or_none(Cheque, cheque_id)
    if not cheque:
        return error("Cheque não encontrado.", 404)
    photo = get_photo_or_none(cheque, "CHEQUE", attachment_id)
    if not photo:
        return error("Foto não encontrada.", 404)
    return remove_photo(cheque, photo, "cheque", g.current_user)
