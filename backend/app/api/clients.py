"""Client endpoints."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import false

from ..extensions import db
from ..models import Client, ClientStatus, Role
from ..services.clients import (
    client_history,
    create_client,
    delete_client,
    overdue_client_ids,
    serialize_client,
    serialize_clients,
    set_client_block,
    update_client,
)
from ..utils.responses import error, json_body, paginated, pagination_args
from ..utils.security import auth_required
from ..utils.validators import ValidationError, clean_text

bp = Blueprint("clients", __name__, url_prefix="/api/clients")


def _get_client_or_none(client_id: int) -> Client | None:
    client = db.session.get(Client, client_id)
    if not client or client.is_deleted:
        return None
    return client


@bp.get("")
@auth_required()
def list_clients():
    page, per_page = pagination_args()
    query = Client.query.filter(Client.is_deleted.is_(False))

    search = clean_text(request.args.get("search"))
    if search:
        like = f"%{search}%"
        digits = "".join(ch for ch in search if ch.isdigit())
        conditions = [
            Client.name.ilike(like),
            Client.code.ilike(like),
            Client.email.ilike(like),
            Client.city.ilike(like),
            Client.document.ilike(f"%{digits}%") if digits else Client.document.ilike(like),
        ]
        query = query.filter(db.or_(*conditions))

    if request.args.get("status") in ClientStatus.ALL:
        query = query.filter(Client.status == request.args["status"])

    blocked_filter = request.args.get("blocked")
    if blocked_filter in ("1", "true", "True"):
        query = query.filter(Client.is_blocked.is_(True))
    elif blocked_filter in ("0", "false", "False"):
        query = query.filter(Client.is_blocked.is_(False))

    if request.args.get("overdue") in ("1", "true", "True"):
        ids = overdue_client_ids()
        query = query.filter(Client.id.in_(ids) if ids else false())

    sort = request.args.get("sort", "name")
    sort_map = {
        "name": Client.name,
        "code": Client.code,
        "registered_at": Client.registered_at,
        "operational_limit": Client.operational_limit,
        "created_at": Client.created_at,
    }
    column = sort_map.get(sort, Client.name)
    order = column.desc() if request.args.get("order") == "desc" else column.asc()
    query = query.order_by(order, Client.id.asc())

    total = query.count()
    clients = query.offset((page - 1) * per_page).limit(per_page).all()
    items = serialize_clients(clients)

    base = Client.query.filter(Client.is_deleted.is_(False))
    totals = {
        "clients": total,
        "active": base.filter(Client.status == ClientStatus.ACTIVE).count(),
        "inactive": base.filter(Client.status == ClientStatus.INACTIVE).count(),
        "blocked": base.filter(Client.is_blocked.is_(True)).count(),
        "operational_limit": float(
            db.session.query(db.func.coalesce(db.func.sum(Client.operational_limit), 0))
            .filter(Client.is_deleted.is_(False))
            .scalar()
            or 0
        ),
    }
    return paginated(items, page, per_page, total, totals)


@bp.get("/options")
@auth_required()
def client_options():
    search = clean_text(request.args.get("search"))
    query = Client.query.filter(Client.is_deleted.is_(False))
    if request.args.get("only_active", "1") == "1":
        query = query.filter(Client.status == ClientStatus.ACTIVE)
    if search:
        like = f"%{search}%"
        query = query.filter(
            db.or_(Client.name.ilike(like), Client.code.ilike(like), Client.document.ilike(f"%{search}%"))
        )
    clients = query.order_by(Client.name.asc()).limit(50).all()
    serialized = serialize_clients(clients)
    return jsonify(
        {
            "items": [
                {
                    "id": item["id"],
                    "code": item["code"],
                    "name": item["name"],
                    "document": item["document"],
                    "whatsapp": item["whatsapp"],
                    "status": item["status"],
                    "operational_limit": item["operational_limit"],
                    "open_amount": item["summary"]["open_amount"],
                    "available_limit": item["summary"]["available_limit"],
                }
                for item in serialized
            ]
        }
    )


@bp.get("/<int:client_id>")
@auth_required()
def get_client(client_id: int):
    client = _get_client_or_none(client_id)
    if not client:
        return error("Cliente não encontrado.", 404)
    return jsonify({"item": serialize_client(client)})


@bp.get("/<int:client_id>/history")
@auth_required()
def get_client_history(client_id: int):
    client = _get_client_or_none(client_id)
    if not client:
        return error("Cliente não encontrado.", 404)
    return jsonify(client_history(client))


@bp.post("")
@auth_required(Role.ADMIN, Role.OPERATOR)
def new_client():
    client = create_client(json_body(), g.current_user)
    return jsonify({"item": serialize_client(client), "message": "Cliente cadastrado com sucesso."}), 201


@bp.put("/<int:client_id>")
@auth_required(Role.ADMIN, Role.OPERATOR)
def edit_client(client_id: int):
    client = _get_client_or_none(client_id)
    if not client:
        return error("Cliente não encontrado.", 404)
    client = update_client(client, json_body(), g.current_user)
    return jsonify({"item": serialize_client(client), "message": "Cliente atualizado com sucesso."})


@bp.patch("/<int:client_id>/block")
@auth_required(Role.ADMIN, Role.OPERATOR)
def block_client(client_id: int):
    client = _get_client_or_none(client_id)
    if not client:
        return error("Cliente não encontrado.", 404)
    payload = json_body()
    blocked = payload.get("blocked")
    if not isinstance(blocked, bool):
        raise ValidationError({"blocked": "Informe blocked como verdadeiro ou falso."})
    client = set_client_block(client, blocked, payload.get("reason"), g.current_user)
    action = "bloqueado" if blocked else "desbloqueado"
    return jsonify(
        {
            "item": serialize_client(client),
            "message": f"Cliente {action} com sucesso.",
        }
    )


@bp.delete("/<int:client_id>")
@auth_required(Role.ADMIN)
def remove_client(client_id: int):
    client = _get_client_or_none(client_id)
    if not client:
        return error("Cliente não encontrado.", 404)
    delete_client(client, g.current_user)
    return jsonify({"message": "Cliente excluído com sucesso."})
