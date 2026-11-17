"""User administration and audit trail (ADMIN only)."""
from __future__ import annotations

from datetime import date, datetime, time, timezone

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import AuditAction, AuditLog, Role, User
from ..services.audit import log_action
from ..utils.responses import error, json_body, paginated, pagination_args, validation_error
from ..utils.security import auth_required, current_user
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_choice,
    parse_date,
    parse_email,
    parse_int,
    validate_password_strength,
)

bp = Blueprint("users", __name__, url_prefix="/api/users")


def _active_admin_count(exclude_id: int | None = None) -> int:
    query = User.query.filter(User.role == Role.ADMIN, User.is_active.is_(True))
    if exclude_id:
        query = query.filter(User.id != exclude_id)
    return query.count()


def _validate_user_payload(payload: dict, existing: User | None = None, *, require_password: bool = False) -> dict:
    errors: dict[str, str] = {}
    data: dict = {}

    name = clean_text(payload.get("name"), 120)
    if not name or len(name) < 3:
        errors["name"] = "Informe o nome (mínimo 3 caracteres)."
    else:
        data["name"] = name

    try:
        email = parse_email(payload.get("email"), "email", required=True)
        duplicate = User.query.filter(db.func.lower(User.email) == email.lower())
        if existing:
            duplicate = duplicate.filter(User.id != existing.id)
        if duplicate.first():
            errors["email"] = "Já existe um usuário com este e-mail."
        else:
            data["email"] = email
    except ValidationError as exc:
        errors.update(exc.errors)
        email = None

    try:
        data["role"] = parse_choice(payload.get("role"), Role.ALL, "role")
    except ValidationError as exc:
        errors.update(exc.errors)

    if "is_active" in payload:
        data["is_active"] = bool(payload.get("is_active"))

    password = payload.get("password") or ""
    if require_password or password:
        try:
            data["password"] = validate_password_strength(password)
        except ValidationError as exc:
            errors.update(exc.errors)

    if errors:
        raise ValidationError(errors)
    return data


@bp.get("")
@auth_required(Role.ADMIN)
def list_users():
    users = User.query.order_by(User.is_active.desc(), User.name.asc()).all()
    return jsonify(
        {
            "items": [user.to_dict() for user in users],
            "meta": {"total": len(users)},
            "roles": [{"value": role, "label": Role.LABELS[role]} for role in Role.ALL],
        }
    )


@bp.post("")
@auth_required(Role.ADMIN)
def create_user():
    payload = json_body()
    data = _validate_user_payload(payload, require_password=True)
    password = data.pop("password")
    user = User(
        name=data["name"],
        email=data["email"].lower(),
        role=data["role"],
        is_active=data.get("is_active", True),
        must_change_password=True,
        created_by_id=current_user().id,
    )
    user.set_password(password)
    db.session.add(user)
    db.session.flush()
    log_action(
        AuditAction.CREATE,
        "user",
        user.id,
        f"Usuário {user.email} criado com perfil {Role.LABELS[user.role]}",
        {"role": user.role},
    )
    db.session.commit()
    return jsonify({"item": user.to_dict(), "message": "Usuário criado com sucesso."}), 201


@bp.put("/<int:user_id>")
@auth_required(Role.ADMIN)
def update_user(user_id: int):
    user = db.session.get(User, user_id)
    if not user:
        return error("Usuário não encontrado.", 404)
    payload = json_body()
    data = _validate_user_payload(payload, existing=user)

    if user.id == current_user().id:
        if data.get("is_active") is False:
            return error("Você não pode desativar o próprio usuário.", 400)
        if data.get("role") != Role.ADMIN:
            return error("Você não pode remover o próprio perfil de administrador.", 400)

    new_role = data.get("role", user.role)
    new_active = data.get("is_active", user.is_active)
    if user.role == Role.ADMIN and user.is_active and (new_role != Role.ADMIN or not new_active):
        if _active_admin_count(exclude_id=user.id) == 0:
            return error("O sistema precisa de pelo menos um administrador ativo.", 400)

    before = {"name": user.name, "email": user.email, "role": user.role, "is_active": user.is_active}
    user.name = data.get("name", user.name)
    user.email = data.get("email", user.email).lower()
    user.role = new_role
    user.is_active = new_active
    user.updated_by_id = current_user().id
    changes = {
        key: [before[key], getattr(user, key)]
        for key in before
        if before[key] != getattr(user, key)
    }
    if changes:
        log_action(AuditAction.UPDATE, "user", user.id, f"Usuário {user.email} atualizado", changes)
    db.session.commit()
    return jsonify({"item": user.to_dict(), "message": "Usuário atualizado com sucesso."})


@bp.post("/<int:user_id>/reset-password")
@auth_required(Role.ADMIN)
def admin_reset_password(user_id: int):
    user = db.session.get(User, user_id)
    if not user:
        return error("Usuário não encontrado.", 404)
    payload = json_body()
    try:
        password = validate_password_strength(payload.get("password") or "")
    except ValidationError as exc:
        return validation_error(exc)
    user.set_password(password)
    user.must_change_password = True
    user.updated_by_id = current_user().id
    log_action(
        AuditAction.PASSWORD_RESET,
        "user",
        user.id,
        f"Senha redefinida pelo administrador para {user.email}",
    )
    db.session.commit()
    return jsonify({"message": "Senha redefinida. O usuário deverá alterá-la no próximo acesso."})


@bp.get("/audit-logs")
@auth_required(Role.ADMIN)
def audit_logs():
    page, per_page = pagination_args()
    query = AuditLog.query

    if request.args.get("entity"):
        query = query.filter(AuditLog.entity == request.args["entity"])
    if request.args.get("action"):
        query = query.filter(AuditLog.action == request.args["action"])
    if request.args.get("user_id"):
        try:
            query = query.filter(AuditLog.user_id == int(request.args["user_id"]))
        except ValueError:
            pass
    if request.args.get("search"):
        like = f"%{request.args['search'].strip()}%"
        query = query.filter(
            db.or_(
                AuditLog.description.ilike(like),
                AuditLog.user_email.ilike(like),
                AuditLog.entity.ilike(like),
            )
        )
    try:
        if request.args.get("date_from"):
            start = date.fromisoformat(request.args["date_from"])
            query = query.filter(AuditLog.created_at >= datetime.combine(start, time.min, tzinfo=timezone.utc))
        if request.args.get("date_to"):
            end = date.fromisoformat(request.args["date_to"])
            query = query.filter(AuditLog.created_at <= datetime.combine(end, time.max, tzinfo=timezone.utc))
    except ValueError:
        pass

    total = query.count()
    items = (
        query.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return paginated([entry.to_dict() for entry in items], page, per_page, total)
