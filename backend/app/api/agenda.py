"""Shared agenda endpoints."""
from __future__ import annotations

from datetime import date, datetime, time

from flask import Blueprint, g, jsonify, request

from ..extensions import db
from ..models import AgendaEvent, AuditAction, Role
from ..services.audit import diff_changes, log_action
from ..utils.responses import error, json_body
from ..utils.security import auth_required
from ..utils.validators import ValidationError, clean_text

bp = Blueprint("agenda", __name__, url_prefix="/api/agenda")
EVENT_COLORS = {"green", "blue", "amber", "rose", "violet"}


def _parse_datetime(value, field: str, *, required: bool = True) -> datetime | None:
    if value in (None, ""):
        if required:
            raise ValidationError({field: "Informe data e horário."})
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError({field: "Data e horário inválidos."})
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed.replace(second=0, microsecond=0)


def _parse_period(value, field: str) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        parsed_date = date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError({field: "Use uma data no formato AAAA-MM-DD."})
    return datetime.combine(parsed_date, time.min)


def _parse_payload(payload: dict) -> dict:
    title = clean_text(payload.get("title"))
    errors = {}
    if not title:
        errors["title"] = "Informe o título do compromisso."
    elif len(title) > 160:
        errors["title"] = "O título deve ter no máximo 160 caracteres."

    location = clean_text(payload.get("location"))
    if location and len(location) > 180:
        errors["location"] = "O local deve ter no máximo 180 caracteres."

    description = clean_text(payload.get("description"))
    if description and len(description) > 4000:
        errors["description"] = "A descrição deve ter no máximo 4.000 caracteres."

    color = payload.get("color", "green")
    if not isinstance(color, str) or color not in EVENT_COLORS:
        errors["color"] = "Escolha uma cor disponível."

    try:
        start_at = _parse_datetime(payload.get("start_at"), "start_at")
    except ValidationError as exc:
        errors.update(exc.errors)
        start_at = None
    try:
        end_at = _parse_datetime(payload.get("end_at"), "end_at")
    except ValidationError as exc:
        errors.update(exc.errors)
        end_at = None

    if start_at and end_at and end_at <= start_at:
        errors["end_at"] = "O horário de término deve ser posterior ao início."
    if errors:
        raise ValidationError(errors)
    return {
        "title": title,
        "start_at": start_at,
        "end_at": end_at,
        "location": location,
        "description": description,
        "color": color,
    }


def _get_event(event_id: int) -> AgendaEvent | None:
    event = db.session.get(AgendaEvent, event_id)
    return event if event and not event.is_deleted else None


@bp.get("")
@auth_required()
def list_events():
    start = _parse_period(request.args.get("start"), "start")
    end = _parse_period(request.args.get("end"), "end")
    if not start:
        raise ValidationError({"start": "Informe o início do período."})
    if not end:
        raise ValidationError({"end": "Informe o fim do período."})
    if start and end and end <= start:
        raise ValidationError({"end": "O fim do período deve ser posterior ao início."})

    query = AgendaEvent.query.filter(AgendaEvent.is_deleted.is_(False))
    query = query.filter(AgendaEvent.end_at >= start, AgendaEvent.start_at < end)
    events = query.order_by(AgendaEvent.start_at.asc(), AgendaEvent.id.asc()).all()
    return jsonify({"items": [event.to_dict() for event in events]})


@bp.post("")
@auth_required(Role.ADMIN, Role.OPERATOR)
def create_event():
    values = _parse_payload(json_body())
    event = AgendaEvent(**values, created_by_id=g.current_user.id, updated_by_id=g.current_user.id)
    db.session.add(event)
    db.session.flush()
    log_action(
        AuditAction.CREATE,
        "agenda_event",
        event.id,
        f"Compromisso criado: {event.title}",
        changes=values,
    )
    db.session.commit()
    return jsonify({"item": event.to_dict(), "message": "Compromisso criado com sucesso."}), 201


@bp.put("/<int:event_id>")
@auth_required(Role.ADMIN, Role.OPERATOR)
def update_event(event_id: int):
    event = _get_event(event_id)
    if not event:
        return error("Compromisso não encontrado.", 404)
    values = _parse_payload(json_body())
    before = {key: getattr(event, key) for key in values}
    for key, value in values.items():
        setattr(event, key, value)
    event.updated_by_id = g.current_user.id
    log_action(
        AuditAction.UPDATE,
        "agenda_event",
        event.id,
        f"Compromisso atualizado: {event.title}",
        changes=diff_changes(before, values),
    )
    db.session.commit()
    return jsonify({"item": event.to_dict(), "message": "Compromisso atualizado com sucesso."})


@bp.delete("/<int:event_id>")
@auth_required(Role.ADMIN)
def delete_event(event_id: int):
    event = _get_event(event_id)
    if not event:
        return error("Compromisso não encontrado.", 404)
    event.soft_delete(g.current_user.id)
    log_action(
        AuditAction.DELETE,
        "agenda_event",
        event.id,
        f"Compromisso excluído: {event.title}",
        changes={"is_deleted": [False, True]},
    )
    db.session.commit()
    return jsonify({"message": "Compromisso excluído com sucesso."})
