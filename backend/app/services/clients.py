"""Client business rules: validation, duplicate prevention and limits summary."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func

from ..extensions import db
from ..models import (
    AuditAction,
    Boleto,
    Cheque,
    Client,
    ClientStatus,
    DocumentStatus,
    Installment,
    Loan,
    LoanStatus,
    Operation,
    Receipt,
    Role,
)
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_choice,
    parse_date,
    parse_email,
    parse_money,
    parse_phone,
    parse_state,
    parse_zip,
    validate_document,
)
from .audit import diff_changes, log_action


class _Collector:
    """Collect field errors so the user receives every problem at once."""

    def __init__(self):
        self.errors: dict[str, str] = {}
        self.data: dict = {}

    def add(self, field: str, parser, *args, **kwargs):
        try:
            self.data[field] = parser(*args, **kwargs)
        except ValidationError as exc:
            self.errors.update(exc.errors)

    def raise_if_errors(self):
        if self.errors:
            raise ValidationError(self.errors)


def _validate_name(value) -> str:
    name = clean_text(value, 180)
    if not name or len(name) < 3:
        raise ValidationError({"name": "Informe o nome completo ou a razão social (mínimo 3 caracteres)."})
    return name


def build_client_payload(payload: dict, existing: Client | None = None) -> dict:
    c = _Collector()
    today = date.today()

    c.add("name", _validate_name, payload.get("name"))

    document_error = None
    try:
        document, person_type = validate_document(payload.get("document") or "")
        c.data["document"] = document
        c.data["person_type"] = person_type
    except ValidationError as exc:
        c.errors.update(exc.errors)
        document_error = True

    c.add("email", parse_email, payload.get("email"), "email")
    c.add("phone", parse_phone, payload.get("phone"), "phone")
    c.add("whatsapp", parse_phone, payload.get("whatsapp"), "whatsapp")
    c.add("zip_code", parse_zip, payload.get("zip_code"), "zip_code")
    c.add("state", parse_state, payload.get("state"), "state")
    c.add("operational_limit", parse_money, payload.get("operational_limit"), "operational_limit", required=False, label="o limite operacional")
    c.add(
        "registered_at",
        parse_date,
        payload.get("registered_at") or today,
        "registered_at",
        required=False,
        label="a data de cadastro",
    )
    c.add(
        "status",
        parse_choice,
        payload.get("status") or ClientStatus.ACTIVE,
        ClientStatus.ALL,
        "status",
        required=False,
        default=ClientStatus.ACTIVE,
    )

    c.data["address"] = clean_text(payload.get("address"), 220)
    c.data["city"] = clean_text(payload.get("city"), 120)
    c.data["notes"] = clean_text(payload.get("notes"), 2000)

    c.raise_if_errors()

    if not c.data.get("whatsapp"):
        c.data["whatsapp"] = c.data.get("phone")
    if c.data.get("registered_at") is None:
        c.data["registered_at"] = today
    if c.data.get("operational_limit") is None:
        c.data["operational_limit"] = Decimal("0.00")
    if not c.data.get("status"):
        c.data["status"] = ClientStatus.ACTIVE

    # Duplicate CPF/CNPJ check among active (not deleted) records.
    if not document_error:
        duplicate_query = Client.query.filter(
            Client.document == c.data["document"], Client.is_deleted.is_(False)
        )
        if existing is not None:
            duplicate_query = duplicate_query.filter(Client.id != existing.id)
        duplicate = duplicate_query.first()
        if duplicate:
            raise ValidationError(
                {"document": f"Já existe um cliente com este CPF/CNPJ: {duplicate.code} - {duplicate.name}."}
            )

    return c.data


def create_client(payload: dict, user) -> Client:
    data = build_client_payload(payload)
    client = Client(code=f"TMP-{uuid4().hex[:10]}", created_by_id=user.id, **data)
    db.session.add(client)
    db.session.flush()
    client.code = f"CLI-{client.id:04d}"
    log_action(
        AuditAction.CREATE,
        "client",
        client.id,
        f"Cliente {client.code} cadastrado",
        changes={"name": client.name, "document": client.document},
    )
    db.session.commit()
    return client


def update_client(client: Client, payload: dict, user) -> Client:
    data = build_client_payload(payload, existing=client)
    before = client.to_dict()
    for field, value in data.items():
        setattr(client, field, value)
    client.updated_by_id = user.id
    after = client.to_dict()
    changes = diff_changes(before, after)
    if changes:
        log_action(
            AuditAction.UPDATE,
            "client",
            client.id,
            f"Cliente {client.code} atualizado",
            changes=changes,
        )
    db.session.commit()
    return client


def delete_client(client: Client, user) -> None:
    if user.role != Role.ADMIN:
        raise PermissionError("Apenas administradores podem excluir clientes.")
    open_documents = client.open_documents()
    if open_documents:
        raise ValidationError(
            {
                "client": (
                    f"Não é possível excluir: existem {len(open_documents)} documento(s) "
                    "em aberto vinculados a este cliente."
                )
            }
        )
    active_operations = client.operations.filter_by(is_deleted=False).count()
    if active_operations:
        raise ValidationError(
            {
                "client": (
                    f"Não é possível excluir: existem {active_operations} operação(ões) vinculadas "
                    "a este cliente."
                )
            }
        )
    active_loans = client.loans.filter_by(is_deleted=False).count()
    if active_loans:
        raise ValidationError(
            {
                "client": (
                    f"Não é possível excluir: existem {active_loans} empréstimo(s) vinculado(s) "
                    "a este cliente."
                )
            }
        )
    client.soft_delete(user.id)
    log_action(
        AuditAction.DELETE,
        "client",
        client.id,
        f"Cliente {client.code} excluído logicamente",
        changes={"name": client.name, "document": client.document},
    )
    db.session.commit()


def _exposure_map(client_ids: list[int]) -> dict[int, dict]:
    """Open exposure (net amount) per client in a single query per document type."""
    result: dict[int, dict] = {
        cid: {
            "open_amount": Decimal("0.00"),
            "overdue_amount": Decimal("0.00"),
            "open_documents": 0,
            "overdue_documents": 0,
        }
        for cid in client_ids
    }
    if not client_ids:
        return result

    today = date.today()
    for model in (Cheque, Boleto):
        rows = (
            db.session.query(
                model.client_id,
                func.coalesce(func.sum(model.net_amount), 0),
                func.count(model.id),
            )
            .filter(
                model.client_id.in_(client_ids),
                model.is_deleted.is_(False),
                model.status.in_(DocumentStatus.PENDING),
            )
            .group_by(model.client_id)
            .all()
        )
        for client_id, total, count in rows:
            result[client_id]["open_amount"] += Decimal(total or 0)
            result[client_id]["open_documents"] += count

        overdue_rows = (
            db.session.query(
                model.client_id,
                func.coalesce(func.sum(model.net_amount), 0),
                func.count(model.id),
            )
            .filter(
                model.client_id.in_(client_ids),
                model.is_deleted.is_(False),
                model.status.in_(DocumentStatus.PENDING),
                model.due_date < today,
            )
            .group_by(model.client_id)
            .all()
        )
        for client_id, total, count in overdue_rows:
            result[client_id]["overdue_amount"] += Decimal(total or 0)
            result[client_id]["overdue_documents"] += count

    # Empréstimos também consomem limite: as parcelas em aberto entram na mesma
    # exposição usada por clientes, relatórios e dashboard.
    loan_filters = (
        Loan.client_id.in_(client_ids),
        Loan.is_deleted.is_(False),
        Loan.status != LoanStatus.CANCELLED,
        Installment.is_deleted.is_(False),
        Installment.status.in_(DocumentStatus.PENDING),
    )
    loan_rows = (
        db.session.query(
            Loan.client_id,
            func.coalesce(func.sum(Installment.amount), 0),
            func.count(Installment.id),
        )
        .join(Installment, Installment.loan_id == Loan.id)
        .filter(*loan_filters)
        .group_by(Loan.client_id)
        .all()
    )
    for client_id, total, count in loan_rows:
        result[client_id]["open_amount"] += Decimal(total or 0)
        result[client_id]["open_documents"] += count

    loan_overdue_rows = (
        db.session.query(
            Loan.client_id,
            func.coalesce(func.sum(Installment.amount), 0),
            func.count(Installment.id),
        )
        .join(Installment, Installment.loan_id == Loan.id)
        .filter(*loan_filters, Installment.due_date < today)
        .group_by(Loan.client_id)
        .all()
    )
    for client_id, total, count in loan_overdue_rows:
        result[client_id]["overdue_amount"] += Decimal(total or 0)
        result[client_id]["overdue_documents"] += count

    return result


# Public alias: reports reuse the same exposure calculation (never stored).
exposure_map = _exposure_map


def serialize_client(client: Client, exposure: dict | None = None) -> dict:
    data = client.to_dict()
    exposure = exposure or _exposure_map([client.id])[client.id]
    limit = Decimal(client.operational_limit or 0)
    open_amount = Decimal(exposure["open_amount"] or 0)
    available = limit - open_amount
    data["summary"] = {
        "operational_limit": float(limit.quantize(Decimal("0.01"))),
        "open_amount": float(open_amount.quantize(Decimal("0.01"))),
        "overdue_amount": float(Decimal(exposure["overdue_amount"] or 0).quantize(Decimal("0.01"))),
        "open_documents": exposure["open_documents"],
        "overdue_documents": exposure["overdue_documents"],
        "available_limit": float(available.quantize(Decimal("0.01"))),
        "limit_usage_percent": (
            float((open_amount / limit * 100).quantize(Decimal("0.01"))) if limit > 0 else None
        ),
        "limit_exceeded": bool(limit > 0 and open_amount > limit),
    }
    return data


def serialize_clients(clients: list[Client]) -> list[dict]:
    exposure = _exposure_map([c.id for c in clients])
    return [serialize_client(c, exposure.get(c.id)) for c in clients]


def _document_nominal(document) -> Decimal:
    """Cheques expose nominal_amount; boletos expose original_amount."""
    value = getattr(document, "nominal_amount", None)
    if value is None:
        value = getattr(document, "original_amount", 0)
    return Decimal(value or 0)


def client_history(client: Client) -> dict:
    from ..models import AuditLog
    from .receipts import serialize_receipt

    documents = []
    for doc in client.open_documents():
        documents.append(doc.to_dict(include_notes=False))

    all_docs = (
        Cheque.query.filter_by(client_id=client.id, is_deleted=False).all()
        + Boleto.query.filter_by(client_id=client.id, is_deleted=False).all()
    )
    all_docs.sort(key=lambda d: d.operation_date or date.min, reverse=True)

    operations = (
        Operation.query.filter_by(client_id=client.id, is_deleted=False)
        .order_by(Operation.operation_date.desc(), Operation.id.desc())
        .limit(50)
        .all()
    )
    receipts = (
        Receipt.query.filter_by(client_id=client.id, is_deleted=False)
        .order_by(Receipt.receipt_date.desc(), Receipt.id.desc())
        .limit(50)
        .all()
    )

    timeline = [
        {
            "type": "document",
            "date": (doc.operation_date or doc.created_at.date()).isoformat(),
            "title": f"{'Cheque' if doc.__class__.__name__ == 'Cheque' else 'Boleto'} {doc.code}",
            "description": f"Valor nominal R$ {_document_nominal(doc)} - {doc.status_label}",
            "status": doc.status,
        }
        for doc in all_docs[:50]
    ]
    timeline.extend(
        {
            "type": "operation",
            "date": operation.operation_date.isoformat(),
            "title": f"Operação {operation.code}",
            "description": (
                f"{operation.totals()['documents']} documento(s) - "
                f"líquido R$ {operation.totals()['net']:.2f} - {operation.status_label}"
            ),
            "status": operation.status,
        }
        for operation in operations
    )
    timeline.extend(
        {
            "type": "receipt",
            "date": receipt.receipt_date.isoformat(),
            "title": f"Recebimento {receipt.code}",
            "description": (
                f"{receipt.document_label} #{receipt.document_id} - "
                f"R$ {float(receipt.amount or 0):.2f}"
            ),
            "status": receipt.document_kind,
        }
        for receipt in receipts
    )
    audit_entries = (
        AuditLog.query.filter_by(entity="client", entity_id=client.id)
        .order_by(AuditLog.created_at.desc())
        .limit(30)
        .all()
    )
    timeline.extend(
        {
            "type": "audit",
            "date": entry.created_at.isoformat(),
            "title": entry.description or entry.action,
            "description": f"por {entry.user.name if entry.user else entry.user_email or 'sistema'}",
            "status": entry.action,
        }
        for entry in audit_entries
    )
    timeline.sort(key=lambda item: item["date"], reverse=True)

    totals = {
        "nominal": 0.0,
        "net": 0.0,
        "open": 0.0,
        "settled": 0.0,
        "received": 0.0,
        "count": len(all_docs),
    }
    for doc in all_docs:
        totals["nominal"] += float(_document_nominal(doc))
        totals["net"] += float(doc.net_amount or 0)
        if doc.status in DocumentStatus.PENDING:
            totals["open"] += float(doc.net_amount or 0)
        if doc.status == DocumentStatus.SETTLED:
            totals["settled"] += float(doc.net_amount or 0)
    for receipt in receipts:
        totals["received"] += float(receipt.amount or 0)

    return {
        "client": serialize_client(client),
        "open_documents": documents,
        "documents": [doc.to_dict() for doc in all_docs],
        "operations": [operation.to_dict(include_items=False) for operation in operations],
        "receipts": [serialize_receipt(receipt) for receipt in receipts],
        "timeline": timeline,
        "totals": {key: round(value, 2) for key, value in totals.items()},
    }
