"""FACTOR PRO - application factory."""
from __future__ import annotations

import logging
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from .config import BASE_DIR, get_config, ProductionConfig
from .extensions import cors, db, jwt, migrate
from .utils.validators import ValidationError


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ValidationError)
    def handle_validation_error(error: ValidationError):
        return jsonify({"message": error.message, "errors": error.errors}), 422

    @app.errorhandler(PermissionError)
    def handle_permission_error(error: PermissionError):
        app.logger.warning("Operação não permitida: %s", error)
        return jsonify({"message": "Operação não permitida."}), 403

    @app.errorhandler(HTTPException)
    def handle_http_exception(error: HTTPException):
        return (
            jsonify({"message": error.description or "Erro na requisição.", "errors": {}}),
            error.code or 500,
        )

    @app.errorhandler(413)
    def handle_payload_too_large(error):  # pragma: no cover - covered by manual test
        limit_mb = app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024)
        return (
            jsonify({"message": f"Arquivo muito grande. Limite de {limit_mb} MB por anexo."}),
            413,
        )

    @app.errorhandler(Exception)
    def handle_unexpected(error: Exception):  # pragma: no cover - safety net
        app.logger.exception("Erro não tratado: %s", error)
        if isinstance(error, HTTPException):
            return handle_http_exception(error)
        if app.config.get("TESTING"):
            raise error
        return jsonify({"message": "Erro interno no servidor. Tente novamente."}), 500


def _register_jwt_handlers() -> None:
    @jwt.unauthorized_loader
    def missing_token(reason):
        return jsonify({"message": "Autenticação necessária."}), 401

    @jwt.invalid_token_loader
    def invalid_token(reason):
        return jsonify({"message": "Sessão inválida. Entre novamente."}), 401

    @jwt.expired_token_loader
    def expired_token(header, payload):
        return jsonify({"message": "Sessão expirada. Entre novamente."}), 401

    @jwt.revoked_token_loader
    def revoked_token(header, payload):
        return jsonify({"message": "Sessão encerrada."}), 401

    @jwt.token_verification_failed_loader
    def verification_failed(header, payload):
        return jsonify({"message": "Sessão inválida."}), 401


def _register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        if request.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


def _register_spa(app: Flask) -> None:
    """Serve the compiled React app when frontend/dist exists (single deployment)."""
    dist = (BASE_DIR.parent / "frontend" / "dist").resolve()
    if not dist.exists():
        return

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_spa(path: str):
        if path.startswith("api/"):
            return jsonify({"message": "Rota não encontrada."}), 404
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist in candidate.parents:
            return send_from_directory(dist, path)
        return send_from_directory(dist, "index.html")


def create_app(config_name: str | None = None) -> Flask:
    app = Flask(
        __name__,
        instance_relative_config=True,
        static_folder=None,
    )
    config_class = get_config(config_name)
    app.config.from_object(config_class)

    if config_class is ProductionConfig:
        if "sqlite" in app.config["SQLALCHEMY_DATABASE_URI"]:
            raise RuntimeError(
                "Produção exige PostgreSQL. Configure DATABASE_URL "
                "(postgresql+psycopg2://...) no arquivo .env."
            )
        if app.config["SECRET_KEY"].startswith("dev-"):
            raise RuntimeError("Produção exige SECRET_KEY própria no arquivo .env.")
        if not app.config.get("MAIL_SERVER"):
            raise RuntimeError(
                "Produção exige MAIL_SERVER configurado para envio das instruções "
                "de recuperação de senha."
            )

    # Folders
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    upload_folder = Path(app.config["UPLOAD_FOLDER"])
    if not upload_folder.is_absolute():
        upload_folder = (BASE_DIR / upload_folder).resolve()
    upload_folder.mkdir(parents=True, exist_ok=True)
    app.config["UPLOAD_FOLDER"] = str(upload_folder)

    # Extensions
    db.init_app(app)
    migrate.init_app(app, db, compare_type=True)
    jwt.init_app(app)
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

    _register_error_handlers(app)
    _register_jwt_handlers()
    _register_security_headers(app)

    # Blueprints
    from .api import register_blueprints
    from .cli import register_cli

    register_blueprints(app)
    register_cli(app)
    _register_spa(app)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "app": "FACTOR PRO", "version": app.config.get("APP_VERSION", "1.0.0")})

    if not app.config.get("TESTING"):
        logging.getLogger("werkzeug").setLevel(logging.INFO)

    return app
