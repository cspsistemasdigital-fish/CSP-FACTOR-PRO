"""Receipt (recebimento) business rules.

Every settlement is a manual, explicit action: the operator informs the date and
the amount received. The system never calculates interest, discount or fees - it
only compares the informed amount with the document's net value to show the
remaining balance and to suggest the settlement status.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, or_

from ..extensions import db
from ..models import (
    AuditAction,
    AuditLog,
    Boleto,
    Cheque,
    Client,
    DocumentKind,
    DocumentStatus,
    Receipt,
    Role,
)
from ..models.base import iso, money, utcnow
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_date,
    parse_int,
    parse_money,
    format_brl,
)
from .audit import diff_changes, log_action


def resolve_document(kind: str, document_id: int):
    model = Cheque if kind == DocumentKind.CHEQUE else Boleto
    return db.session.get(model, document_id)


def document_kind_of(document) -> str:
    return DocumentKind.CHEQUE if isinstance(document, Cheque) else DocumentKind.BOLETO


def received_amount(document_kind: str, document_id: int, exclude_receipt_id: int | None = None) -> Decimal:
    query = db.session.query(func.coalesce(func.sum(Receipt.amount), 0)).filter(
        Receipt.document_kind == document_kind,
        Receipt.document_id == document_id,
        Receipt.is_deleted.is_(False),
    )
    if exclude_receipt_id:
        query = query.filter(Receipt.id != exclude_receipt_id)
    return Decimal(query.scalar() or 0)


def _sync_document_status(document, user) -> None:
    """Settle the document when fully received; revert on estorno.

    This runs only as a consequence of an explicit receipt action - the system
    never changes a status by itself, and every change is audited.
    """
    if document is None or document.is_deleted:
        return
    kind = document_kind_of(document)
    received = received_amount(kind, document.id)
    net = Decimal(document.net_amount or 0)
    entity = document.__class__.__name__.lower()

    if net > 0 and received >= net and document.status in DocumentStatus.PENDING:
        before = document.status
        document.status = DocumentStatus.SETTLED
        document.updated_by_id = user.id
        log_action(
            AuditAction.STATUS_CHANGE,
            entity,
            document.id,
            f"{document.code}: liquidado automaticamente após recebimento de {format_brl(received)}",
            changes={"status": [before, DocumentStatus.SETTLED]},
        )
    elif document.status == DocumentStatus.SETTLED and received < net:
        document.status = DocumentStatus.OPEN
        document.updated_by_id = user.id
        log_action(
            AuditAction.STATUS_CHANGE,
            entity,
            document.id,
            f"{document.code}: status revertido para Em aberto após estorno de recebimento",
            changes={"status": [DocumentStatus.SETTLED, DocumentStatus.OPEN]},
        )


def build_receipt_payload(payload: dict, existing: Receipt | None = None) -> tuple[dict, object, list]:
    errors: dict[str, str] = {}
    warnings: list = []

    kind = payload.get("document_kind")
    if kind not in DocumentKind.ALL:
        errors["document_kind"] = "Informe o tipo de documento (cheque ou boleto)."
        kind = None

    try:
        document_id = parse_int(payload.get("document_id"), "document_id", required=True, minimum=1)
    except ValidationError as exc:
        errors.update(exc.errors)
        document_id = None

    document = None
    if kind and document_id:
        document = resolve_document(kind, document_id)
        if not document or document.is_deleted:
            errors["document_id"] = "Documento não encontrado."

    try:
        receipt_date = parse_date(
            payload.get("receipt_date") or date.today(),
            "receipt_date",
            label="a data do recebimento",
        )
    except ValidationError as exc:
        errors.update(exc.errors)
        receipt_date = None

    try:
        amount = parse_money(
            payload.get("amount"), "amount", required=True, allow_zero=False, label="o valor recebido"
        )
    except ValidationError as exc:
        errors.update(exc.errors)
        amount = None

    if errors:
        raise ValidationError(errors)

    # Comparison only (never blocks automatic fees, only alerts the operator).
    if document is not None and amount is not None:
        received = received_amount(
            kind, document.id, exclude_receipt_id=existing.id if existing else None
        )
        remaining = Decimal(document.net_amount or 0) - received
        if remaining >= 0 and amount > remaining:
            warnings.append(
                {
                    "field": "amount",
                    "message": (
                        f"O valor informado ({format_brl(amount)}) é maior que o saldo em aberto do "
                        f"documento ({format_brl(remaining)}). O recebimento foi gravado exatamente "
                        "como informado."
                    ),
                }
            )

    data = {
        "document_kind": kind,
        "document_id": document.id if document else None,
        "client_id": document.client_id if document else None,
        "receipt_date": receipt_date,
        "amount": amount,
        "notes": clean_text(payload.get("notes"), 2000),
    }
    return data, document, warnings


def create_receipt(payload: dict, user) -> tuple[Receipt, list]:
    data, document, warnings = build_receipt_payload(payload)
    receipt = Receipt(code=f"TMP-{uuid4().hex[:10]}", created_by_id=user.id, **data)
    db.session.add(receipt)
    db.session.flush()
    receipt.code = f"REC-{receipt.id:05d}"
    log_action(
        AuditAction.CREATE,
        "receipt",
        receipt.id,
        f"Recebimento {receipt.code} registrado para {document.code}",
        changes={
            "document": document.code,
            "amount": float(receipt.amount),
            "receipt_date": receipt.receipt_date.isoformat(),
        },
    )
    _sync_document_status(document, user)
    db.session.commit()
    return receipt, warnings


def update_receipt(receipt: Receipt, payload: dict, user) -> tuple[Receipt, list]:
    previous_document = receipt.resolve_document()
    data, document, warnings = build_receipt_payload(payload, existing=receipt)
    before = receipt.to_dict()
    for field, value in data.items():
        setattr(receipt, field, value)
    receipt.updated_by_id = user.id
    after = receipt.to_dict()
    changes = diff_changes(before, after)
    if changes:
        log_action(
            AuditAction.UPDATE,
            "receipt",
            receipt.id,
            f"Recebimento {receipt.code} atualizado",
            changes=changes,
        )
    db.session.flush()
    if previous_document is not None and (document is None or previous_document.id != document.id):
        _sync_document_status(previous_document, user)
    if document is not None:
        _sync_document_status(document, user)
    db.session.commit()
    return receipt, warnings


def estorno_receipt(receipt: Receipt, user) -> None:
    """Estorno = logical deletion of the receipt (ADMIN only, audited)."""
    if user.role != Role.ADMIN:
        raise PermissionError("Apenas administradores podem estornar recebimentos.")
    document = receipt.resolve_document()
    receipt.soft_delete(user.id)
    log_action(
        AuditAction.DELETE,
        "receipt",
        receipt.id,
        f"Recebimento {receipt.code} estornado (exclusão lógica)",
        changes={"amount": float(receipt.amount), "document": document.code if document else None},
    )
    db.session.flush()
    if document is not None:
        _sync_document_status(document, user)
    db.session.commit()


def receipt_history(receipt: Receipt) -> list[dict]:
    entries = (
        AuditLog.query.filter_by(entity="receipt", entity_id=receipt.id)
        .order_by(AuditLog.created_at.desc())
        .limit(40)
        .all()
    )
    return [entry.to_dict() for entry in entries]


def serialize_receipt(receipt: Receipt) -> dict:
    data = receipt.to_dict()
    document = receipt.resolve_document()
    net = Decimal(document.net_amount or 0) if document else Decimal("0.00")
    received = received_amount(receipt.document_kind, receipt.document_id)
    data["document_net"] = money(net)
    data["received_total"] = money(received)
    data["remaining_amount"] = money(net - received)
    data["is_settled"] = bool(document and document.status == DocumentStatus.SETTLED)
    return data


def open_documents(
    client_id: int | None = None, search: str | None = None, kind: str | None = None
) -> list[dict]:
    """Pending documents with their received and remaining balances."""
    results: list[dict] = []
    for model, doc_kind in ((Cheque, DocumentKind.CHEQUE), (Boleto, DocumentKind.BOLETO)):
        if kind and kind != doc_kind:
            continue
        query = model.query.filter(
            model.is_deleted.is_(False),
            model.status.in_(DocumentStatus.PENDING),
        )
        if client_id:
            query = query.filter(model.client_id == client_id)
        if search:
            like = f"%{search.strip()}%"
            query = query.join(Client, model.client_id == Client.id).filter(
                or_(
                    model.code.ilike(like),
                    model.bank.ilike(like),
                    model.identifier.ilike(like),
                    Client.name.ilike(like),
                    Client.code.ilike(like),
                )
            )
        for document in query.order_by(model.due_date.asc(), model.id.asc()).limit(300).all():
            received = received_amount(doc_kind, document.id)
            item = document.to_dict(include_notes=False)
            item["received_amount"] = money(received)
            item["remaining_amount"] = money(Decimal(document.net_amount or 0) - received)
            results.append(item)
    results.sort(key=lambda item: (item.get("due_date") or "", item.get("code") or ""))
    return results


def build_recibo(receipt: Receipt) -> dict:
    """Printable receipt payload: company data + real receipt/document data."""
    from ..api.settings import get_company_settings

    document = receipt.resolve_document()
    net = Decimal(document.net_amount or 0) if document else Decimal("0.00")
    received = received_amount(receipt.document_kind, receipt.document_id)
    return {
        "number": receipt.code,
        "issued_at": iso(utcnow()),
        "amount": money(receipt.amount),
        "document_net": money(net),
        "received_total": money(received),
        "remaining_amount": money(net - received),
        "receipt": receipt.to_dict(),
        "document": document.to_dict() if document else None,
        "client": receipt.client.to_dict() if receipt.client else None,
        "company": get_company_settings(),
    }


def _apply_filters(query, args):
    if args.get("document_kind") in DocumentKind.ALL:
        query = query.filter(Receipt.document_kind == args["document_kind"])
    if args.get("client_id"):
        try:
            query = query.filter(Receipt.client_id == int(args["client_id"]))
        except (TypeError, ValueError):
            pass
    if args.get("document_id"):
        try:
            query = query.filter(Receipt.document_id == int(args["document_id"]))
        except (TypeError, ValueError):
            pass
    for arg, operator in (("date_from", "ge"), ("date_to", "le")):
        if args.get(arg):
            try:
                value = date.fromisoformat(args[arg])
            except ValueError:
                continue
            query = query.filter(
                Receipt.receipt_date >= value if operator == "ge" else Receipt.receipt_date <= value
            )

    search = (args.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        query = query.join(Client, Receipt.client_id == Client.id).filter(
            or_(
                Receipt.code.ilike(like),
                Receipt.notes.ilike(like),
                Client.name.ilike(like),
                Client.code.ilike(like),
            )
        )

    sort = args.get("sort") or "receipt_date"
    allowed_sorts = {
        "code": Receipt.code,
        "receipt_date": Receipt.receipt_date,
        "amount": Receipt.amount,
        "created_at": Receipt.created_at,
    }
    column = allowed_sorts.get(sort, Receipt.receipt_date)
    if (args.get("order") or "desc").lower() == "asc":
        return query.order_by(column.asc(), Receipt.id.asc())
    return query.order_by(column.desc(), Receipt.id.desc())


def list_totals(query) -> dict:
    base = query.order_by(None)
    row = base.with_entities(
        func.count(Receipt.id),
        func.coalesce(func.sum(Receipt.amount), 0),
    ).one()
    return {
        "receipts": int(row[0] or 0),
        "amount": float(row[1] or 0),
    }
