"""Global alerts endpoint used by the startup notification banner."""
from __future__ import annotations

from flask import Blueprint, jsonify

from ..services.alerts import build_alerts
from ..utils.security import auth_required

bp = Blueprint("alerts", __name__, url_prefix="/api/alerts")


@bp.get("")
@auth_required()
def alerts():
    return jsonify(build_alerts())
