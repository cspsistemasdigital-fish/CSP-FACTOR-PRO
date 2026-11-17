"""Dashboard aggregation endpoint (real data only)."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import Client
from ..services.dashboard import build_dashboard
from ..utils.security import auth_required
from ..utils.validators import ValidationError, parse_date, parse_int

bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


@bp.get("/summary")
@auth_required()
def summary():
    try:
        date_from = parse_date(request.args.get("date_from"), "date_from", required=False)
        date_to = parse_date(request.args.get("date_to"), "date_to", required=False)
        client_id = parse_int(request.args.get("client_id"), "client_id", required=False, minimum=1)
    except ValidationError as exc:
        return jsonify({"message": exc.message, "errors": exc.errors}), 422

    if date_from and date_to and date_from > date_to:
        return jsonify({"message": "A data inicial não pode ser maior que a final.", "errors": {}}), 422

    if client_id:
        client = db.session.get(Client, client_id)
        if not client or client.is_deleted:
            return jsonify({"message": "Cliente não encontrado.", "errors": {}}), 404

    return jsonify(build_dashboard(date_from, date_to, client_id))
