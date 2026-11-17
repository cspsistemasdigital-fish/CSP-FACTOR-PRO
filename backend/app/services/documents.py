"""Cheque and Boleto business rules.

The system NEVER calculates interest or discount automatically. Every monetary
value is informed by the user and stored exactly as typed. The only derived
values are *comparisons* used for alerts (divergence / overdue).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, or_

from ..extensions import db
from ..models import AuditAction, Boleto, Cheque, Client, ClientStatus, DocumentKind, DocumentStatus, Receipt
from ..utils.validators import (
    ValidationError,
    clean_text,
    format_brl,
    parse_choice,
    parse_date,
    parse_int,
    parse_money,
    validate_document,
)
from .audit import diff_changes, log_action

MAX_AMOUNT = Decimal("999999999999.99")


def _required_text(value, field: str, label: str, max_length: int) -> str:
    text = clean_text(value, max_length)
    if not text:
        raise ValidationError({field: f"Informe {label}."})
    return text


def _optional_text(value, field: str, max_length: int) -> str | None:
    return clean_text(value, max_length)


def _amount(value, field: str, label: str, *, required: bool = True, allow_zero: bool = True) -> Decimal:
    amount = parse_money(value, field, required=required, allow_zero=allow_zero, label=label)
    if amount > MAX_AMOUNT:
        raise ValidationError({field: "Valor acima do limite permitido pelo sistema."})
    return amount


def _resolve_client(payload: dict, errors: dict, *, require_active: bool = True) -> Client | None:
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
        errors["client_id"] = f"O cliente {client.code} está inativo e não pode receber novos documentos."
        return None
    if require_active and getattr(client, "is_blocked", False):
        reason = client.blocked_reason or "títulos em atraso"
        errors["client_id"] = (
            f"O cliente {client.code} está bloqueado por inadimplência ({reason}) "
            "e não pode receber novos documentos."
        )
        return None
    return client


def _validate_status(value) -> str:
    return parse_choice(
        value or DocumentStatus.OPEN,
        DocumentStatus.ALL,
        "status",
        required=False,
        default=DocumentStatus.OPEN,
    )


def _validate_divergence(nominal: Decimal, costs: Decimal, net: Decimal, net_field: str, costs_field: str):
    if costs > nominal:
        raise ValidationError(
            {costs_field: "A soma de descontos, juros e despesas não pode superar o valor nominal."}
        )
    if net > nominal:
        raise ValidationError({net_field: "O valor líquido não pode ser maior que o valor nominal."})
    expected = nominal - costs
    divergence = (expected - net).quantize(Decimal("0.01"))
    warnings = []
    if abs(divergence) > Decimal("0.01"):
        warnings.append(
            {
                "field": net_field,
                "message": (
                    "Divergência entre os valores informados: valor nominal menos descontos/despesas = "
                    f"{format_brl(expected)}, enquanto o líquido informado é {format_brl(net)} "
                    f"(diferença de {format_brl(divergence)}). Os valores foram salvos exatamente como informados."
                ),
            }
        )
    return warnings


def _check_dates(issue_date, due_date, operation_date, errors: dict) -> None:
    if issue_date and due_date and due_date < issue_date:
        errors["due_date"] = "A data de vencimento não pode ser anterior à data de emissão."


# --------------------------------------------------------------------------
# Cheques
# --------------------------------------------------------------------------
def build_cheque_payload(payload: dict, existing: Cheque | None = None) -> tuple[dict, list]:
    errors: dict[str, str] = {}
    data: dict = {}
    warnings: list = []

    def run(field, parser, *args, **kwargs):
        try:
            data[field] = parser(*args, **kwargs)
        except ValidationError as exc:
            errors.update(exc.errors)

    # Editing an existing document remains possible after a block, so arrears
    # can be corrected; only new documents are prevented.
    client = _resolve_client(payload, errors, require_active=existing is None)
    run("number", _required_text, payload.get("number"), "number", "o número do cheque", 30)
    run("bank", _required_text, payload.get("bank"), "bank", "o banco", 80)
    run("agency", _optional_text, payload.get("agency"), "agency", 20)
    run("account", _optional_text, payload.get("account"), "account", 30)
    run("identifier", _optional_text, payload.get("identifier"), "identifier", 60)

    try:
        issuer_document, _ = validate_document(payload.get("issuer_document") or "", "issuer_document")
        data["issuer_document"] = issuer_document
    except ValidationError as exc:
        errors.update(exc.errors)
    run("issuer_name", _required_text, payload.get("issuer_name"), "issuer_name", "o nome do emitente", 180)

    run("nominal_amount", _amount, payload.get("nominal_amount"), "nominal_amount", "o valor nominal", allow_zero=False)
    run("discount_amount", _amount, payload.get("discount_amount", 0), "discount_amount", "o valor do desconto")
    run("interest_amount", _amount, payload.get("interest_amount", 0), "interest_amount", "o valor dos juros")
    run("other_expenses", _amount, payload.get("other_expenses", 0), "other_expenses", "outras despesas")
    run("net_amount", _amount, payload.get("net_amount"), "net_amount", "o valor líquido pago ao cliente")
    run("applied_limit", _amount, payload.get("applied_limit"), "applied_limit", "o limite de desconto aplicado", required=False)

    run("issue_date", parse_date, payload.get("issue_date"), "issue_date", required=False, label="a data de emissão")
    run("due_date", parse_date, payload.get("due_date"), "due_date", label="o vencimento")
    run("operation_date", parse_date, payload.get("operation_date") or date.today(), "operation_date", label="a data da operação")
    run("status", _validate_status, payload.get("status"))

    data["notes"] = clean_text(payload.get("notes"), 2000)
    data["client_id"] = client.id if client else None

    _check_dates(data.get("issue_date"), data.get("due_date"), data.get("operation_date"), errors)

    if not errors:
        try:
            warnings = _validate_divergence(
                data["nominal_amount"],
                data["discount_amount"] + data["interest_amount"] + data["other_expenses"],
                data["net_amount"],
                "net_amount",
                "discount_amount",
            )
        except ValidationError as exc:
            errors.update(exc.errors)

    if errors:
        raise ValidationError(errors)
    return data, warnings


def create_cheque(payload: dict, user) -> tuple[Cheque, list]:
    data, warnings = build_cheque_payload(payload)
    cheque = Cheque(code=f"TMP-{uuid4().hex[:10]}", created_by_id=user.id, **data)
    db.session.add(cheque)
    db.session.flush()
    cheque.code = f"CHQ-{cheque.id:05d}"
    log_action(
        AuditAction.CREATE,
        "cheque",
        cheque.id,
        f"Cheque {cheque.code} cadastrado",
        changes={
            "client_id": cheque.client_id,
            "nominal_amount": float(cheque.nominal_amount),
            "net_amount": float(cheque.net_amount),
        },
    )
    db.session.commit()
    return cheque, warnings


def update_cheque(cheque: Cheque, payload: dict, user) -> tuple[Cheque, list]:
    data, warnings = build_cheque_payload(payload, existing=cheque)
    before = cheque.to_dict()
    for field, value in data.items():
        setattr(cheque, field, value)
    cheque.updated_by_id = user.id
    after = cheque.to_dict()
    changes = diff_changes(before, after)
    if changes:
        log_action(
            AuditAction.UPDATE,
            "cheque",
            cheque.id,
            f"Cheque {cheque.code} atualizado",
            changes=changes,
        )
    db.session.commit()
    return cheque, warnings


# --------------------------------------------------------------------------
# Boletos
# --------------------------------------------------------------------------
def build_boleto_payload(payload: dict, existing: Boleto | None = None) -> tuple[dict, list]:
    errors: dict[str, str] = {}
    data: dict = {}
    warnings: list = []

    def run(field, parser, *args, **kwargs):
        try:
            data[field] = parser(*args, **kwargs)
        except ValidationError as exc:
            errors.update(exc.errors)

    # Editing an existing document remains possible after a block, so arrears
    # can be corrected; only new documents are prevented.
    client = _resolve_client(payload, errors, require_active=existing is None)
    run("identifier", _required_text, payload.get("identifier"), "identifier", "a identificação do boleto", 60)
    run("barcode", _optional_text, payload.get("barcode"), "barcode", 80)
    run("bank", _required_text, payload.get("bank"), "bank", "o banco emissor", 80)

    try:
        beneficiary_document, _ = validate_document(
            payload.get("beneficiary_document") or "", "beneficiary_document"
        )
        data["beneficiary_document"] = beneficiary_document
    except ValidationError as exc:
        errors.update(exc.errors)
    run(
        "beneficiary_name",
        _required_text,
        payload.get("beneficiary_name"),
        "beneficiary_name",
        "o nome do beneficiário",
        180,
    )

    run("original_amount", _amount, payload.get("original_amount"), "original_amount", "o valor original", allow_zero=False)
    run("discount_amount", _amount, payload.get("discount_amount", 0), "discount_amount", "o valor dos juros/desconto")
    run("other_expenses", _amount, payload.get("other_expenses", 0), "other_expenses", "outras despesas")
    run("net_amount", _amount, payload.get("net_amount"), "net_amount", "o valor líquido pago ao cliente")
    run("applied_limit", _amount, payload.get("applied_limit"), "applied_limit", "o limite operacional aplicado", required=False)

    run("issue_date", parse_date, payload.get("issue_date"), "issue_date", required=False, label="a data de emissão")
    run("due_date", parse_date, payload.get("due_date"), "due_date", label="o vencimento")
    run("operation_date", parse_date, payload.get("operation_date") or date.today(), "operation_date", label="a data da operação")
    run("status", _validate_status, payload.get("status"))

    data["notes"] = clean_text(payload.get("notes"), 2000)
    data["client_id"] = client.id if client else None

    _check_dates(data.get("issue_date"), data.get("due_date"), data.get("operation_date"), errors)

    if not errors:
        try:
            warnings = _validate_divergence(
                data["original_amount"],
                data["discount_amount"] + data["other_expenses"],
                data["net_amount"],
                "net_amount",
                "discount_amount",
            )
        except ValidationError as exc:
            errors.update(exc.errors)

    if errors:
        raise ValidationError(errors)
    return data, warnings


def create_boleto(payload: dict, user) -> tuple[Boleto, list]:
    data, warnings = build_boleto_payload(payload)
    boleto = Boleto(code=f"TMP-{uuid4().hex[:10]}", created_by_id=user.id, **data)
    db.session.add(boleto)
    db.session.flush()
    boleto.code = f"BOL-{boleto.id:05d}"
    log_action(
        AuditAction.CREATE,
        "boleto",
        boleto.id,
        f"Boleto {boleto.code} cadastrado",
        changes={
            "client_id": boleto.client_id,
            "original_amount": float(boleto.original_amount),
            "net_amount": float(boleto.net_amount),
        },
    )
    db.session.commit()
    return boleto, warnings


def update_boleto(boleto: Boleto, payload: dict, user) -> tuple[Boleto, list]:
    data, warnings = build_boleto_payload(payload, existing=boleto)
    before = boleto.to_dict()
    for field, value in data.items():
        setattr(boleto, field, value)
    boleto.updated_by_id = user.id
    after = boleto.to_dict()
    changes = diff_changes(before, after)
    if changes:
        log_action(
            AuditAction.UPDATE,
            "boleto",
            boleto.id,
            f"Boleto {boleto.code} atualizado",
            changes=changes,
        )
    db.session.commit()
    return boleto, warnings


# --------------------------------------------------------------------------
# Shared operations
# --------------------------------------------------------------------------
def change_status(document, new_status: str, user) -> None:
    status = parse_choice(new_status, DocumentStatus.ALL, "status")
    if document.status == status:
        return
    before = document.status
    document.status = status
    document.updated_by_id = user.id
    log_action(
        AuditAction.STATUS_CHANGE,
        document.__class__.__name__.lower(),
        document.id,
        f"{document.code}: status alterado de {DocumentStatus.LABELS.get(before, before)} "
        f"para {DocumentStatus.LABELS.get(status, status)}",
        changes={"status": [before, status]},
    )
    db.session.commit()


def delete_document(document, user) -> None:
    kind = DocumentKind.CHEQUE if isinstance(document, Cheque) else DocumentKind.BOLETO
    receipts = Receipt.query.filter_by(
        document_kind=kind, document_id=document.id, is_deleted=False
    ).count()
    if receipts:
        raise ValidationError(
            {
                "document": (
                    f"Não é possível excluir: existem {receipts} recebimento(s) vinculados a este "
                    "documento. Estorne os recebimentos antes de excluí-lo."
                )
            }
        )
    document.soft_delete(user.id)
    log_action(
        AuditAction.DELETE,
        document.__class__.__name__.lower(),
        document.id,
        f"{document.code} excluído logicamente",
        changes={"status": document.status},
    )
    db.session.commit()


def _apply_filters(query, model, args, kind: str):
    """Apply the common list filters used by cheques and boletos."""
    if args.get("status"):
        status = args.get("status")
        if status == "VENCIDO":
            query = query.filter(model.status.in_(DocumentStatus.PENDING), model.due_date < date.today())
        elif status in DocumentStatus.ALL:
            query = query.filter(model.status == status)
    if args.get("client_id"):
        try:
            query = query.filter(model.client_id == int(args["client_id"]))
        except (TypeError, ValueError):
            pass
    if args.get("bank"):
        query = query.filter(model.bank.ilike(f"%{args['bank'].strip()}%"))
    if args.get("overdue") in ("1", "true", "True"):
        query = query.filter(model.status.in_(DocumentStatus.PENDING), model.due_date < date.today())
    if args.get("divergent") in ("1", "true", "True"):
        # nominal - costs <> net (SQL expression; never used for automatic fees)
        if kind == "cheque":
            query = query.filter(
                func.abs(
                    model.nominal_amount
                    - model.discount_amount
                    - model.interest_amount
                    - model.other_expenses
                    - model.net_amount
                )
                > Decimal("0.01")
            )
        else:
            query = query.filter(
                func.abs(model.original_amount - model.discount_amount - model.other_expenses - model.net_amount)
                > Decimal("0.01")
            )

    for arg, column in (("date_from", model.operation_date), ("date_to", model.operation_date)):
        if args.get(arg):
            try:
                value = date.fromisoformat(args[arg])
            except ValueError:
                continue
            query = query.filter(column >= value) if arg == "date_from" else query.filter(column <= value)

    if args.get("due_from"):
        try:
            query = query.filter(model.due_date >= date.fromisoformat(args["due_from"]))
        except ValueError:
            pass
    if args.get("due_to"):
        try:
            query = query.filter(model.due_date <= date.fromisoformat(args["due_to"]))
        except ValueError:
            pass

    search = (args.get("search") or "").strip()
    if search:
        query = query.join(Client, model.client_id == Client.id)
        like = f"%{search}%"
        if kind == "cheque":
            query = query.filter(
                or_(
                    model.code.ilike(like),
                    model.number.ilike(like),
                    model.identifier.ilike(like),
                    model.bank.ilike(like),
                    model.issuer_name.ilike(like),
                    Client.name.ilike(like),
                    Client.code.ilike(like),
                )
            )
        else:
            query = query.filter(
                or_(
                    model.code.ilike(like),
                    model.identifier.ilike(like),
                    model.barcode.ilike(like),
                    model.bank.ilike(like),
                    model.beneficiary_name.ilike(like),
                    Client.name.ilike(like),
                    Client.code.ilike(like),
                )
            )

    sort = args.get("sort") or "operation_date"
    nominal_column = model.nominal_amount if kind == "cheque" else model.original_amount
    allowed_sorts = {
        "code": model.code,
        "operation_date": model.operation_date,
        "due_date": model.due_date,
        "nominal_amount": nominal_column,
        "net_amount": model.net_amount,
        "created_at": model.created_at,
    }
    column = allowed_sorts.get(sort, model.operation_date)
    if (args.get("order") or "desc").lower() == "asc":
        return query.order_by(column.asc(), model.id.asc())
    return query.order_by(column.desc(), model.id.desc())


def list_totals(query, model, kind: str) -> dict:
    nominal_column = model.nominal_amount if kind == "cheque" else model.original_amount
    base = query.order_by(None)
    row = base.with_entities(
        func.count(model.id),
        func.coalesce(func.sum(nominal_column), 0),
        func.coalesce(func.sum(model.net_amount), 0),
        func.coalesce(func.sum(model.discount_amount), 0),
        func.coalesce(func.sum(model.other_expenses), 0),
    ).one()
    pending_row = base.with_entities(func.coalesce(func.sum(model.net_amount), 0)).filter(
        model.status.in_(DocumentStatus.PENDING)
    ).one()
    count, nominal, net, discount, other = row
    return {
        "count": int(count or 0),
        "nominal": float(nominal or 0),
        "net": float(net or 0),
        "discount": float(discount or 0),
        "other_expenses": float(other or 0),
        "open": float(pending_row[0] or 0),
        "gains": float((nominal or 0) - (net or 0)),
    }
