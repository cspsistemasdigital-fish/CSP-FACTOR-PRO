"""Validation and persistence helpers for saved report filters (Etapa 5)."""
from __future__ import annotations

from ..extensions import db
from ..models import REPORT_KINDS, DocumentStatus, LoanStatus, ReportFilter
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_date,
    parse_int,
)

MAX_FILTERS_PER_USER = 20
MAX_NAME_LENGTH = 60
MAX_SEARCH_LENGTH = 120


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_saved_filters(raw) -> dict:
    """Validate and canonicalize the filter payload stored for a user."""
    if not isinstance(raw, dict):
        raise ValidationError({"filters": "Filtros inválidos."})

    errors: dict[str, str] = {}
    try:
        date_from = parse_date(raw.get("date_from"), "date_from", required=False)
    except ValidationError as exc:
        errors.update(exc.errors)
        date_from = None
    try:
        date_to = parse_date(raw.get("date_to"), "date_to", required=False)
    except ValidationError as exc:
        errors.update(exc.errors)
        date_to = None
    if date_from and date_to and date_from > date_to:
        errors["date_to"] = "A data inicial não pode ser maior que a data final."

    try:
        client_id = parse_int(raw.get("client_id"), "client_id", required=False, minimum=1)
    except ValidationError as exc:
        errors.update(exc.errors)
        client_id = None

    kind = (clean_text(raw.get("kind"), 20) or "").upper() or None
    if kind and kind not in REPORT_KINDS:
        errors["kind"] = "Tipo inválido."

    status = (clean_text(raw.get("status"), 20) or "").upper() or None
    if status and status not in DocumentStatus.ALL:
        errors["status"] = "Situação inválida."

    loan_status = (clean_text(raw.get("loan_status"), 20) or "").upper() or None
    if loan_status and loan_status not in LoanStatus.ALL:
        errors["loan_status"] = "Situação de empréstimo inválida."

    search = clean_text(raw.get("search"), MAX_SEARCH_LENGTH)
    if search and len(str(raw.get("search")).strip()) > MAX_SEARCH_LENGTH:
        errors["search"] = f"A busca deve ter no máximo {MAX_SEARCH_LENGTH} caracteres."

    if errors:
        raise ValidationError(errors)

    filters: dict = {}
    if date_from:
        filters["date_from"] = date_from.isoformat()
    if date_to:
        filters["date_to"] = date_to.isoformat()
    if client_id:
        filters["client_id"] = client_id
        client_name = clean_text(raw.get("client_name"), 120)
        client_code = clean_text(raw.get("client_code"), 20)
        if client_name:
            filters["client_name"] = client_name
        if client_code:
            filters["client_code"] = client_code
    if kind:
        filters["kind"] = kind
    if status:
        filters["status"] = status
    if loan_status:
        filters["loan_status"] = loan_status
    if _as_bool(raw.get("overdue")):
        filters["overdue"] = True
    if search:
        filters["search"] = search
    return filters


def validate_filter_name(value) -> str:
    name = clean_text(value, MAX_NAME_LENGTH + 1)
    if not name:
        raise ValidationError({"name": "Informe um nome para o filtro."})
    if len(name) > MAX_NAME_LENGTH:
        raise ValidationError({"name": f"O nome deve ter no máximo {MAX_NAME_LENGTH} caracteres."})
    return name


def list_filters(user) -> list[ReportFilter]:
    return (
        ReportFilter.query.filter_by(user_id=user.id, is_deleted=False)
        .order_by(ReportFilter.updated_at.desc(), ReportFilter.id.desc())
        .all()
    )


def count_filters(user) -> int:
    return ReportFilter.query.filter_by(user_id=user.id, is_deleted=False).count()


def create_filter(user, name: str, filters: dict) -> ReportFilter:
    if count_filters(user) >= MAX_FILTERS_PER_USER:
        raise ValidationError(
            {"name": f"Você já possui {MAX_FILTERS_PER_USER} filtros salvos. Remova um antes de criar outro."}
        )
    record = ReportFilter(
        user_id=user.id,
        name=name,
        filters=filters,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.session.add(record)
    db.session.commit()
    return record


def delete_filter(user, filter_id: int) -> bool:
    record = ReportFilter.query.filter_by(
        id=filter_id, user_id=user.id, is_deleted=False
    ).first()
    if not record:
        return False
    record.soft_delete(user.id)
    record.updated_by_id = user.id
    db.session.commit()
    return True
