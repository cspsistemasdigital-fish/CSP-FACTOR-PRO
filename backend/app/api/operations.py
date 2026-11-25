"""Operation (borderô) endpoints."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from ..extensions import db
from ..models import Operation, Role
from ..services.operations import (
    _apply_filters,
    available_documents,
    available_loans,
    change_operation_status,
    create_operation,
    delete_operation,
    list_totals,
    operation_history,
    serialize_operation,
    update_operation,
)
from ..utils.responses import error, json_body, paginated, pagination_args
from ..utils.security import auth_required
from ..utils.validators import ValidationError, parse_int

bp = Blueprint("operations", __name__, url_prefix="/api/operations")


def _get_or_none(operation_id: int) -> Operation | None:
    operation = db.session.get(Operation, operation_id)
    if not operation or operation.is_deleted:
        return None
    return operation


@bp.get("")
@auth_required()
def list_operations():
    page, per_page = pagination_args()
    query = Operation.query.filter(Operation.is_deleted.is_(False))
    query = _apply_filters(query, request.args)
    total = query.count()
    totals = list_totals(query)
    items = query.offset((page - 1) * per_page).limit(per_page).all()
    return paginated(
        [serialize_operation(operation, include_items=False) for operation in items],
        page,
        per_page,
        total,
        totals,
    )


@bp.get("/available-documents")
@auth_required()
def list_available_documents():
    try:
        client_id = parse_int(request.args.get("client_id"), "client_id", required=True, minimum=1)
    except ValidationError as exc:
        return jsonify({"message": exc.message, "errors": exc.errors}), 422
    exclude = request.args.get("operation_id")
    exclude_id = int(exclude) if exclude and exclude.isdigit() else None
    items = available_documents(client_id, request.args.get("search"), exclude_id)
    return jsonify({"items": items})


@bp.get("/available-loans")
@auth_required()
def list_available_loans():
    try:
        client_id = parse_int(request.args.get("client_id"), "client_id", required=True, minimum=1)
    except ValidationError as exc:
        return jsonify({"message": exc.message, "errors": exc.errors}), 422
    exclude = request.args.get("operation_id")
    exclude_id = int(exclude) if exclude and exclude.isdigit() else None
    return jsonify({"items": available_loans(client_id, request.args.get("search"), exclude_id)})


@bp.get("/<int:operation_id>")
@auth_required()
def get_operation(operation_id: int):
    operation = _get_or_none(operation_id)
    if not operation:
        return error("Operação não encontrada.", 404)
    return jsonify(
        {
            "item": serialize_operation(operation),
            "history": operation_history(operation),
        }
    )


@bp.post("")
@auth_required(Role.ADMIN, Role.OPERATOR)
def new_operation():
    operation = create_operation(json_body(), g.current_user)
    return (
        jsonify({"item": serialize_operation(operation), "message": "Operação registrada com sucesso."}),
        201,
    )


@bp.put("/<int:operation_id>")
@auth_required(Role.ADMIN, Role.OPERATOR)
def edit_operation(operation_id: int):
    operation = _get_or_none(operation_id)
    if not operation:
        return error("Operação não encontrada.", 404)
    operation = update_operation(operation, json_body(), g.current_user)
    return jsonify({"item": serialize_operation(operation), "message": "Operação atualizada com sucesso."})


@bp.patch("/<int:operation_id>/status")
@auth_required(Role.ADMIN, Role.OPERATOR)
def change_status(operation_id: int):
    operation = _get_or_none(operation_id)
    if not operation:
        return error("Operação não encontrada.", 404)
    payload = json_body()
    change_operation_status(operation, payload.get("status"), g.current_user)
    return jsonify(
        {
            "item": serialize_operation(operation),
            "message": f"Situação da operação alterada para {operation.status_label}.",
        }
    )


@bp.delete("/<int:operation_id>")
@auth_required(Role.ADMIN)
def remove_operation(operation_id: int):
    operation = _get_or_none(operation_id)
    if not operation:
        return error("Operação não encontrada.", 404)
    delete_operation(operation, g.current_user)
    return jsonify({"message": "Operação excluída com sucesso."})
