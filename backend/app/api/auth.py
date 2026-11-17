"""Authentication endpoints: login, refresh, logout, password recovery."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
    set_refresh_cookies,
    unset_jwt_cookies,
)

from ..extensions import db
from ..models import AuditAction, PasswordResetToken, User
from ..services.audit import log_action
from ..services.email import mail_is_configured, send_password_reset_email
from ..utils.responses import error, json_body, validation_error
from ..utils.security import (
    auth_required,
    clear_login_failures,
    current_user,
    login_is_blocked,
    register_login_failure,
)
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_email,
    validate_login_payload,
    validate_password_strength,
)

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _issue_access_token(user: User) -> str:
    return create_access_token(
        identity=str(user.id),
        additional_claims={"role": user.role, "name": user.name},
    )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _is_expired(moment: datetime) -> bool:
    if moment is None:
        return True
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment < datetime.now(timezone.utc)


@bp.post("/login")
def login():
    try:
        payload = json_body()
        email, password = validate_login_payload(payload)
    except ValidationError as exc:
        return validation_error(exc)

    if login_is_blocked(email):
        return error(
            "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.", 429
        )

    user = User.query.filter(db.func.lower(User.email) == email).first()
    if not user or not user.check_password(password):
        register_login_failure(email)
        log_action(
            AuditAction.LOGIN_FAILED,
            "auth",
            getattr(user, "id", None),
            "Tentativa de login inválida",
            {"email": email},
            user=user,
            commit=True,
        )
        return error("E-mail ou senha inválidos.", 401)

    if not user.is_active:
        return error("Usuário inativo. Procure o administrador do sistema.", 403)

    clear_login_failures(email)
    user.last_login_at = datetime.now(timezone.utc)
    log_action(AuditAction.LOGIN, "auth", user.id, f"Login de {user.name}", user=user)
    db.session.commit()

    access_token = _issue_access_token(user)
    refresh_token = create_refresh_token(identity=str(user.id))
    response = jsonify(
        {
            "access_token": access_token,
            "access_expires_in": int(current_app.config["JWT_ACCESS_TOKEN_EXPIRES"].total_seconds()),
            "user": user.to_dict(),
        }
    )
    set_refresh_cookies(response, refresh_token)
    return response


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    identity = get_jwt_identity()
    user = db.session.get(User, int(identity)) if identity else None
    if not user or not user.is_active:
        return error("Sessão inválida. Entre novamente.", 401)
    return jsonify(
        {
            "access_token": _issue_access_token(user),
            "access_expires_in": int(current_app.config["JWT_ACCESS_TOKEN_EXPIRES"].total_seconds()),
            "user": user.to_dict(),
        }
    )


@bp.post("/logout")
@jwt_required(optional=True)
def logout():
    user = None
    identity = get_jwt_identity()
    if identity:
        user = db.session.get(User, int(identity))
        if user:
            log_action(AuditAction.LOGOUT, "auth", user.id, f"Logout de {user.name}", user=user, commit=True)
    response = jsonify({"message": "Sessão encerrada."})
    unset_jwt_cookies(response)
    return response


@bp.get("/me")
@auth_required()
def me():
    return jsonify({"user": current_user().to_dict()})


@bp.post("/change-password")
@auth_required()
def change_password():
    user = current_user()
    try:
        payload = json_body()
        current_password = payload.get("current_password") or ""
        new_password = validate_password_strength(payload.get("new_password") or "", "new_password")
        if not user.check_password(current_password):
            raise ValidationError({"current_password": "Senha atual incorreta."})
        if current_password == new_password:
            raise ValidationError({"new_password": "A nova senha deve ser diferente da atual."})
    except ValidationError as exc:
        return validation_error(exc)

    user.set_password(new_password)
    user.must_change_password = False
    log_action(AuditAction.PASSWORD_CHANGE, "user", user.id, "Senha alterada pelo próprio usuário", user=user)
    db.session.commit()
    return jsonify({"message": "Senha alterada com sucesso."})


@bp.post("/forgot-password")
def forgot_password():
    try:
        payload = json_body()
        email = parse_email(payload.get("email"), "email", required=True)
    except ValidationError as exc:
        return validation_error(exc)

    generic = {
        "message": (
            "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação. "
            "O link é válido por 30 minutos."
        )
    }
    user = User.query.filter(db.func.lower(User.email) == email).first()
    if not user or not user.is_active:
        return jsonify(generic)

    # Invalidate previous unused tokens
    PasswordResetToken.query.filter_by(user_id=user.id, used_at=None).update({"used_at": datetime.now(timezone.utc)})

    token = secrets.token_urlsafe(32)
    record = PasswordResetToken(
        user_id=user.id,
        token_hash=_token_hash(token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=current_app.config["RESET_TOKEN_MINUTES"]),
        requested_ip=request.remote_addr,
    )
    db.session.add(record)
    log_action(AuditAction.PASSWORD_RESET, "user", user.id, "Solicitação de recuperação de senha", user=user)
    db.session.commit()

    base_url = current_app.config.get("FRONTEND_BASE_URL", "").rstrip("/")
    reset_url = f"{base_url}/redefinir-senha?token={quote(token)}"

    # Delivery is optional: without SMTP the flow remains testable in development
    # through the token returned below (never in production).
    email_sent = False
    if mail_is_configured():
        try:
            email_sent = send_password_reset_email(user.email, user.name, reset_url)
        except Exception:  # noqa: BLE001 - delivery failure must not leak details
            current_app.logger.exception("Falha ao enviar e-mail de recuperação")

    if current_app.config.get("EXPOSE_RESET_TOKEN"):
        generic["reset_token"] = token
        generic["reset_url"] = reset_url
        generic["email_sent"] = email_sent
        current_app.logger.info("Token de recuperação para %s: %s", user.email, token)
    elif email_sent:
        generic["message"] = (
            "Se o e-mail estiver cadastrado, enviamos as instruções de recuperação. "
            "O link é válido por 30 minutos."
        )
    return jsonify(generic)


@bp.post("/reset-password")
def reset_password():
    try:
        payload = json_body()
        token = (payload.get("token") or "").strip()
        new_password = validate_password_strength(payload.get("new_password") or "", "new_password")
        if not token:
            raise ValidationError({"token": "Token obrigatório."})
    except ValidationError as exc:
        return validation_error(exc)

    record = PasswordResetToken.query.filter_by(token_hash=_token_hash(token)).first()
    if not record or record.used_at is not None or _is_expired(record.expires_at):
        return error("Token inválido ou expirado. Solicite uma nova recuperação.", 400)

    user = db.session.get(User, record.user_id)
    if not user or not user.is_active:
        return error("Usuário indisponível.", 400)

    user.set_password(new_password)
    user.must_change_password = False
    record.used_at = datetime.now(timezone.utc)
    log_action(AuditAction.PASSWORD_RESET, "user", user.id, "Senha redefinida via token", user=user)
    db.session.commit()
    return jsonify({"message": "Senha redefinida com sucesso. Você já pode entrar."})
