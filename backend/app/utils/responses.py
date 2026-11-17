"""HTTP response helpers: pagination, errors and totals."""
from __future__ import annotations

from flask import jsonify, request

from .validators import ValidationError


def error(message: str, status: int = 400, errors: dict | None = None):
    return jsonify({"message": message, "errors": errors or {}}), status


def validation_error(exc: ValidationError):
    return jsonify({"message": exc.message, "errors": exc.errors}), 422


def pagination_args(default_per_page: int = 20, max_per_page: int = 100) -> tuple[int, int]:
    def to_int(raw, fallback):
        try:
            return int(raw)
        except (TypeError, ValueError):
            return fallback

    page = max(to_int(request.args.get("page"), 1), 1)
    per_page = to_int(request.args.get("per_page"), default_per_page)
    per_page = min(max(per_page, 1), max_per_page)
    return page, per_page


def paginated(items, page: int, per_page: int, total: int, totals: dict | None = None) -> dict:
    pages = (total + per_page - 1) // per_page if per_page else 0
    payload = {
        "items": items,
        "meta": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": pages,
        },
    }
    if totals is not None:
        payload["totals"] = totals
    return jsonify(payload)


def json_body() -> dict:
    from flask import request as flask_request

    data = flask_request.get_json(silent=True)
    if data is None:
        raise ValidationError({"body": "Corpo da requisição inválido (JSON esperado)."})
    if not isinstance(data, dict):
        raise ValidationError({"body": "Corpo da requisição deve ser um objeto JSON."})
    return data
