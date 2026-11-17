"""Loan (empréstimo) business rules.

Every monetary value is informed by the user. The only automatic steps are:
  * suggesting an equal split of the informed principal into installments;
  * comparing the informed values and the client's limit (warnings only).
No interest, discount, fee or charge is ever calculated by the system.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from sqlalchemy import or_

from ..extensions import db
from ..models import (
    AuditAction,
    AuditLog,
    Client,
    ClientStatus,
    DocumentStatus,
    Installment,
    Loan,
    LoanStatus,
    Role,
)
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_choice,
    parse_date,
    parse_int,
    parse_money,
)
from .audit import diff_changes, log_action
from .clients import exposure_map

MAX_INSTALLMENTS = 360

PERIODICITIES = {
    "SEMANAL": ("Semanal", 7, None),
    "QUINZENAL": ("Quinzenal", 15, None),
    "MENSAL": ("Mensal", None, 1),
    "BIMESTRAL": ("Bimestral", None, 2),
    "TRIMESTRAL": ("Trimestral", None, 3),
    "SEMESTRAL": ("Semestral", None, 6),
    "ANUAL": ("Anual", None, 12),
}


def _add_period(value: date, periodicity: str) -> date:
    """Advance a date using calendar months (or fixed days) — never interest."""
    _, days, months = PERIODICITIES[periodicity]
    if days is not None:
        return value + timedelta(days=days)
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def generate_installments(
    principal: Decimal,
    quantity: int,
    first_due_date: date,
    periodicity: str,
) -> list[dict]:
    """Suggest an equal split of the INFORMED principal (editable afterwards)."""
    if periodicity not in PERIODICITIES:
        raise ValidationError({"periodicity": "Periodicidade inválida."})
    if not 1 <= quantity <= MAX_INSTALLMENTS:
        raise ValidationError({"quantity": f"Informe entre 1 e {MAX_INSTALLMENTS} parcelas."})
    base = (Decimal(principal) / Decimal(quantity)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    items = []
    due_date = first_due_date
    allocated = Decimal("0.00")
    for number in range(1, quantity + 1):
        amount = Decimal(principal) - allocated if number == quantity else base
        amount = amount.quantize(Decimal("0.01"))
        allocated += amount
        items.append(
            {"number": number, "due_date": due_date, "amount": amount, "notes": None}
        )
        due_date = _add_period(due_date, periodicity)
    return items


def _resolve_client(payload: dict, errors: dict, *, require_active: bool) -> Client | None:
    try:
        client_id = parse_int(payload.get("client_id"), "client_id", required=True, minimum=1)
    except ValidationError as exc:
        errors.update(exc.errors)
        return None
    client = db.session.get(Client, client_id)
    if not client or client.is_deleted:
        errors["client_id"] = "Cliente não encontrado."
        return None
    if require_active and client.status != ClientStatus.ACTIVE:
        errors["client_id"] = (
            f"O cliente {client.code} está inativo e não pode receber novos empréstimos."
        )
        return None
    return client


def _parse_installments(raw, loan_date: date, loan_amount: Decimal) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise ValidationError({"installments": "Informe ao menos uma parcela."})
    if len(raw) > MAX_INSTALLMENTS:
        raise ValidationError(
            {"installments": f"Um empréstimo pode ter no máximo {MAX_INSTALLMENTS} parcelas."}
        )
    items: list[dict] = []
    errors: dict[str, str] = {}
    for index, entry in enumerate(raw, start=1):
        if not isinstance(entry, dict):
            raise ValidationError({"installments": "Cada parcela deve ser um objeto válido."})
        try:
            due_date = parse_date(
                entry.get("due_date"), f"installments.{index}.due_date", label="o vencimento"
            )
            amount = parse_money(
                entry.get("amount"),
                f"installments.{index}.amount",
                allow_zero=True,
                label="o valor da parcela",
            )
        except ValidationError as exc:
            errors.update(exc.errors)
            continue
        items.append(
            {
                "number": index,
                "due_date": due_date,
                "amount": amount,
                "notes": clean_text(entry.get("notes"), 180),
            }
        )
    if errors:
        raise ValidationError(errors)
    return items


def _value_warnings(loan: Loan) -> list[str]:
    warnings: list[str] = []
    if loan.has_divergence:
        warnings.append(
            "Divergência informada: (valor do empréstimo − lucro) difere do valor que o cliente "
            "receberá. Confira os valores digitados."
        )
    total = sum((Decimal(item.amount or 0) for item in loan.active_installments()), Decimal("0.00"))
    if abs(total - Decimal(loan.loan_amount or 0)) > Decimal("0.01"):
        warnings.append(
            "Atenção: a soma das parcelas difere do valor do empréstimo informado. "
            "Os valores gravados são exatamente os que você digitou."
        )
    return warnings


def client_limit_info(client_id: int, *, additional_amount: Decimal | None = None) -> dict:
    """Limite operacional x exposição em aberto (inclui parcelas de empréstimos)."""
    client = db.session.get(Client, client_id)
    limit = Decimal(client.operational_limit or 0) if client else Decimal("0.00")
    info = exposure_map([client_id]).get(client_id) or {}
    open_amount = Decimal(info.get("open_amount") or 0) + Decimal(additional_amount or 0)
    available = limit - open_amount
    return {
        "operational_limit": float(limit.quantize(Decimal("0.01"))),
        "open_amount": float(open_amount.quantize(Decimal("0.01"))),
        "available_limit": float(available.quantize(Decimal("0.01"))),
        "limit_exceeded": bool(limit > 0 and open_amount > limit),
    }


def build_loan_payload(payload: dict, existing: Loan | None = None) -> dict:
    errors: dict[str, str] = {}
    client = _resolve_client(payload, errors, require_active=existing is None)

    try:
        loan_date = parse_date(
            payload.get("loan_date") or date.today(), "loan_date", label="a data do empréstimo"
        )
    except ValidationError as exc:
        errors.update(exc.errors)
        loan_date = None

    values: dict[str, Decimal] = {}
    for field, label, required in (
        ("loan_amount", "o valor do empréstimo", True),
        ("received_amount", "o valor que o cliente receberá", True),
        ("profit_amount", "o lucro de quem empresta", False),
    ):
        try:
            values[field] = parse_money(
                payload.get(field), field, required=required, allow_zero=True, label=label
            )
        except ValidationError as exc:
            errors.update(exc.errors)
            values[field] = Decimal("0.00")

    status = parse_choice(
        payload.get("status") or LoanStatus.OPEN,
        LoanStatus.ALL,
        "status",
        required=False,
        default=LoanStatus.OPEN,
    )

    raw_installments = payload.get("installments")
    installments: list[dict] | None = None
    if raw_installments is None and existing is None:
        config = payload.get("installments_config") or {}
        try:
            quantity = parse_int(
                config.get("quantity", 1), "quantity", required=True, minimum=1
            )
            first_due = parse_date(
                config.get("first_due_date") or loan_date,
                "first_due_date",
                label="o primeiro vencimento",
            )
            periodicity = parse_choice(
                config.get("periodicity", "MENSAL"), PERIODICITIES, "periodicity"
            )
            installments = generate_installments(
                values["loan_amount"], quantity, first_due, periodicity
            )
        except ValidationError as exc:
            errors.update(exc.errors)
    elif raw_installments is not None:
        try:
            installments = _parse_installments(
                raw_installments, loan_date, values["loan_amount"]
            )
        except ValidationError as exc:
            errors.update(exc.errors)

    if errors:
        raise ValidationError(errors)

    if installments is None:
        installments = [
            {
                "number": item.number,
                "due_date": item.due_date,
                "amount": item.amount,
                "notes": item.notes,
            }
            for item in existing.active_installments()
        ]

    return {
        "client_id": client.id,
        "loan_date": loan_date,
        "notes": clean_text(payload.get("notes"), 2000),
        "status": status or LoanStatus.OPEN,
        "installments": installments,
        **values,
    }


def _replace_installments(loan: Loan, items: list[dict], user_id: int) -> None:
    for old in list(loan.installments):
        if not old.is_deleted:
            old.soft_delete(user_id)
    for item in items:
        db.session.add(Installment(loan_id=loan.id, created_by_id=user_id, **item))


def create_loan(payload: dict, user) -> tuple[Loan, list[str]]:
    data = build_loan_payload(payload)
    installments = data.pop("installments")
    loan = Loan(code=f"TMP-{uuid4().hex[:10]}", created_by_id=user.id, **data)
    db.session.add(loan)
    db.session.flush()
    loan.code = f"EMP-{loan.id:05d}"
    _replace_installments(loan, installments, user.id)
    db.session.flush()
    # A coleção "selectin" pode ter sido carregada antes das parcelas entrarem
    # na sessão; expirar garante que os derivados vejam os dados gravados.
    db.session.expire(loan, ["installments"])
    warnings = _value_warnings(loan)
    limit = client_limit_info(
        loan.client_id,
        additional_amount=sum(
            (Decimal(item.amount or 0) for item in loan.active_installments()), Decimal("0.00")
        ),
    )
    if limit["limit_exceeded"]:
        warnings.append(
            "Limite operacional ultrapassado: a exposição do cliente soma "
            f"R$ {limit['open_amount']:,.2f} para um limite de "
            f"R$ {limit['operational_limit']:,.2f}."
        )
    log_action(
        AuditAction.CREATE,
        "loan",
        loan.id,
        f"Empréstimo {loan.code} registrado com {len(installments)} parcela(s)",
        changes={
            "client_id": loan.client_id,
            "loan_amount": loan.loan_amount,
            "received_amount": loan.received_amount,
            "profit_amount": loan.profit_amount,
            "totals": loan.totals(),
            "warnings": warnings,
        },
    )
    db.session.commit()
    return loan, warnings


def update_loan(loan: Loan, payload: dict, user) -> tuple[Loan, list[str]]:
    data = build_loan_payload(payload, existing=loan)
    installments = data.pop("installments")
    before = loan.to_dict(include_items=False)
    for field, value in data.items():
        setattr(loan, field, value)
    loan.updated_by_id = user.id
    _replace_installments(loan, installments, user.id)
    db.session.flush()
    db.session.expire(loan, ["installments"])
    db.session.refresh(loan)
    after = loan.to_dict(include_items=False)
    changes = diff_changes(before, after)
    warnings = _value_warnings(loan)
    limit = client_limit_info(loan.client_id)
    if limit["limit_exceeded"]:
        warnings.append("A exposição do cliente ultrapassa o limite operacional informado.")
    if changes or warnings:
        log_action(
            AuditAction.UPDATE,
            "loan",
            loan.id,
            f"Empréstimo {loan.code} atualizado",
            changes={**changes, "warnings": warnings} if warnings else changes,
        )
    db.session.commit()
    return loan, warnings


def _sync_installment_status(loan: Loan, status: str) -> None:
    target = {
        LoanStatus.SETTLED: DocumentStatus.SETTLED,
        LoanStatus.CANCELLED: DocumentStatus.CANCELLED,
        LoanStatus.OPEN: DocumentStatus.OPEN,
    }[status]
    for item in loan.active_installments():
        item.status = target


def change_loan_status(loan: Loan, new_status: str, user) -> None:
    status = parse_choice(new_status, LoanStatus.ALL, "status")
    if loan.status == status:
        return
    before = loan.status
    loan.status = status
    loan.updated_by_id = user.id
    _sync_installment_status(loan, status)
    log_action(
        AuditAction.STATUS_CHANGE,
        "loan",
        loan.id,
        f"Empréstimo {loan.code}: situação alterada de "
        f"{LoanStatus.LABELS.get(before, before)} para {LoanStatus.LABELS.get(status, status)}",
        changes={"status": [before, status]},
    )
    db.session.commit()


def delete_loan(loan: Loan, user) -> None:
    if user.role != Role.ADMIN:
        raise PermissionError("Apenas administradores podem excluir empréstimos.")
    for item in loan.active_installments():
        item.soft_delete(user.id)
    loan.soft_delete(user.id)
    log_action(
        AuditAction.DELETE,
        "loan",
        loan.id,
        f"Empréstimo {loan.code} excluído logicamente",
        changes={"code": loan.code, "client_id": loan.client_id},
    )
    db.session.commit()


def loan_history(loan: Loan) -> list[dict]:
    entries = (
        AuditLog.query.filter_by(entity="loan", entity_id=loan.id)
        .order_by(AuditLog.created_at.desc())
        .limit(40)
        .all()
    )
    return [entry.to_dict() for entry in entries]


def serialize_loan(loan: Loan, include_items: bool = True, warnings: list[str] | None = None) -> dict:
    data = loan.to_dict(include_items=include_items)
    data["warnings"] = warnings or []
    data["limit"] = client_limit_info(loan.client_id)
    return data


def _apply_filters(query, args):
    if args.get("status") in LoanStatus.ALL:
        query = query.filter(Loan.status == args["status"])
    if args.get("client_id"):
        try:
            query = query.filter(Loan.client_id == int(args["client_id"]))
        except (TypeError, ValueError):
            pass
    for arg, operator in (("date_from", "ge"), ("date_to", "le")):
        if args.get(arg):
            try:
                value = date.fromisoformat(args[arg])
            except ValueError:
                continue
            query = query.filter(
                Loan.loan_date >= value if operator == "ge" else Loan.loan_date <= value
            )
    search = (args.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        query = query.join(Client, Loan.client_id == Client.id).filter(
            or_(
                Loan.code.ilike(like),
                Loan.notes.ilike(like),
                Client.name.ilike(like),
                Client.code.ilike(like),
                Client.document.ilike(like),
            )
        )
    sorts = {
        "code": Loan.code,
        "loan_date": Loan.loan_date,
        "created_at": Loan.created_at,
        "status": Loan.status,
        "loan_amount": Loan.loan_amount,
    }
    column = sorts.get(args.get("sort") or "loan_date", Loan.loan_date)
    if (args.get("order") or "desc").lower() == "asc":
        return query.order_by(column.asc(), Loan.id.asc())
    return query.order_by(column.desc(), Loan.id.desc())


def list_totals(query) -> dict:
    loans = query.order_by(None).all()
    result = {
        "loans": len(loans),
        "loan_amount": 0.0,
        "received_amount": 0.0,
        "profit_amount": 0.0,
        "open_amount": 0.0,
        "installments": 0,
    }
    for loan in loans:
        result["loan_amount"] += float(loan.loan_amount or 0)
        result["received_amount"] += float(loan.received_amount or 0)
        result["profit_amount"] += float(loan.profit_amount or 0)
        totals = loan.totals()
        result["open_amount"] += float(totals["open_amount"] or 0)
        result["installments"] += int(totals["installments"])
    return {key: round(value, 2) if isinstance(value, float) else value for key, value in result.items()}
