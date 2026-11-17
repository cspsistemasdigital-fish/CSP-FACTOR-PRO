"""Reports, exports and WhatsApp message generation (Etapa 3).

The system never calculates interest, discounts, fees or charges. Every value in
this module is either (a) informed by the user on a cheque/boleto or (b) a
DERIVED aggregation of those informed values (sums, balances and limits). The
report never writes to documents - it only reads and, for exports, audits.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from urllib.parse import quote
from xml.sax.saxutils import escape

from sqlalchemy import func, or_

from ..extensions import db
from ..models import (
    AuditAction,
    Boleto,
    Cheque,
    Client,
    DocumentKind,
    DocumentStatus,
    Installment,
    Loan,
    LoanStatus,
    Operation,
    OperationStatus,
    Receipt,
    REPORT_KIND_LABELS,
    REPORT_KINDS,
)
from ..models.base import money
from ..utils.validators import (
    ValidationError,
    clean_text,
    format_brl,
    parse_date,
    parse_int,
)
from .audit import log_action
from .branding import app_display_name, brand_logo_path, company_display_name
from .clients import exposure_map
from .loans import serialize_loan
from .loans_report import _collect_loans, _installment_item

MAX_EXPORT_ROWS = 5000
PDF_ROW_LIMIT = 400
MONTHLY_LIMIT = 24


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------
def parse_report_filters(args) -> dict:
    """Parse and validate the shared report filters."""
    errors: dict[str, str] = {}

    try:
        date_from = parse_date(args.get("date_from"), "date_from", required=False)
    except ValidationError as exc:
        errors.update(exc.errors)
        date_from = None
    try:
        date_to = parse_date(args.get("date_to"), "date_to", required=False)
    except ValidationError as exc:
        errors.update(exc.errors)
        date_to = None
    try:
        client_id = parse_int(args.get("client_id"), "client_id", required=False, minimum=1)
    except ValidationError as exc:
        errors.update(exc.errors)
        client_id = None

    if date_from and date_to and date_from > date_to:
        errors["date_to"] = "A data inicial não pode ser maior que a data final."

    kind = (args.get("kind") or args.get("document_kind") or "").strip().upper() or None
    if kind and kind not in REPORT_KINDS:
        errors["kind"] = "Tipo inválido."

    status = (args.get("status") or "").strip().upper() or None
    if status and status not in DocumentStatus.ALL:
        errors["status"] = "Situação inválida."

    loan_status = (args.get("loan_status") or "").strip().upper() or None
    if loan_status and loan_status not in LoanStatus.ALL:
        errors["loan_status"] = "Situação de empréstimo inválida."

    if errors:
        raise ValidationError(errors)

    return {
        "date_from": date_from,
        "date_to": date_to,
        "client_id": client_id,
        "kind": kind,
        "status": status,
        "loan_status": loan_status,
        "overdue": str(args.get("overdue") or "").lower() in ("1", "true", "sim", "yes"),
        "search": clean_text(args.get("search"), 120),
    }


def filters_as_dict(filters: dict) -> dict:
    return {
        "date_from": filters["date_from"].isoformat() if filters["date_from"] else None,
        "date_to": filters["date_to"].isoformat() if filters["date_to"] else None,
        "client_id": filters["client_id"],
        "kind": filters["kind"],
        "status": filters["status"],
        "loan_status": filters.get("loan_status"),
        "overdue": filters["overdue"],
        "search": filters["search"],
    }


# ---------------------------------------------------------------------------
# Data collection (read-only)
# ---------------------------------------------------------------------------
def _collect_documents(filters: dict) -> list:
    today = date.today()
    documents = []
    for model, kind in ((Cheque, DocumentKind.CHEQUE), (Boleto, DocumentKind.BOLETO)):
        if filters["kind"] and filters["kind"] != kind:
            continue
        query = model.query.filter(model.is_deleted.is_(False))
        if filters["date_from"]:
            query = query.filter(model.operation_date >= filters["date_from"])
        if filters["date_to"]:
            query = query.filter(model.operation_date <= filters["date_to"])
        if filters["client_id"]:
            query = query.filter(model.client_id == filters["client_id"])
        if filters["status"]:
            query = query.filter(model.status == filters["status"])
        if filters["overdue"]:
            query = query.filter(
                model.status.in_(DocumentStatus.PENDING), model.due_date < today
            )
        if filters["search"]:
            like = f"%{filters['search']}%"
            query = query.join(Client, model.client_id == Client.id).filter(
                or_(
                    model.code.ilike(like),
                    model.bank.ilike(like),
                    model.identifier.ilike(like),
                    Client.name.ilike(like),
                    Client.code.ilike(like),
                )
            )
        documents.extend(query.all())
    documents.sort(key=lambda doc: (doc.due_date or date.max, doc.__class__.__name__, doc.id))
    return documents


def _received_map() -> dict[tuple[str, int], Decimal]:
    rows = (
        db.session.query(
            Receipt.document_kind,
            Receipt.document_id,
            func.coalesce(func.sum(Receipt.amount), 0),
        )
        .filter(Receipt.is_deleted.is_(False))
        .group_by(Receipt.document_kind, Receipt.document_id)
        .all()
    )
    return {(kind, document_id): Decimal(total or 0) for kind, document_id, total in rows}


def _collect_receipts(filters: dict) -> list[Receipt]:
    query = Receipt.query.filter(Receipt.is_deleted.is_(False))
    if filters["date_from"]:
        query = query.filter(Receipt.receipt_date >= filters["date_from"])
    if filters["date_to"]:
        query = query.filter(Receipt.receipt_date <= filters["date_to"])
    if filters["client_id"]:
        query = query.filter(Receipt.client_id == filters["client_id"])
    if filters["kind"]:
        query = query.filter(Receipt.document_kind == filters["kind"])
    if filters["search"]:
        like = f"%{filters['search']}%"
        query = query.join(Client, Receipt.client_id == Client.id).filter(
            or_(
                Receipt.code.ilike(like),
                Receipt.notes.ilike(like),
                Client.name.ilike(like),
                Client.code.ilike(like),
            )
        )
    return query.order_by(Receipt.receipt_date.desc(), Receipt.id.desc()).limit(MAX_EXPORT_ROWS).all()


def _collect_operations(filters: dict) -> list[Operation]:
    query = Operation.query.filter(Operation.is_deleted.is_(False))
    if filters["date_from"]:
        query = query.filter(Operation.operation_date >= filters["date_from"])
    if filters["date_to"]:
        query = query.filter(Operation.operation_date <= filters["date_to"])
    if filters["client_id"]:
        query = query.filter(Operation.client_id == filters["client_id"])
    if filters["search"]:
        like = f"%{filters['search']}%"
        query = query.join(Client, Operation.client_id == Client.id).filter(
            or_(
                Operation.code.ilike(like),
                Operation.description.ilike(like),
                Client.name.ilike(like),
                Client.code.ilike(like),
            )
        )
    return query.order_by(Operation.operation_date.desc(), Operation.id.desc()).limit(MAX_EXPORT_ROWS).all()


def _document_values(document) -> dict:
    nominal = Decimal(getattr(document, "nominal_amount", None) or getattr(document, "original_amount", 0) or 0)
    discount = Decimal(getattr(document, "discount_amount", 0) or 0)
    interest = Decimal(getattr(document, "interest_amount", 0) or 0)
    expenses = Decimal(getattr(document, "other_expenses", 0) or 0)
    net = Decimal(document.net_amount or 0)
    applied = Decimal(document.applied_limit or 0)
    return {
        "nominal": nominal,
        "costs": discount + interest + expenses,
        "net": net,
        "applied_limit": applied,
        "discount": discount,
        "interest": interest,
        "expenses": expenses,
    }


def _document_item(document, received: dict) -> dict:
    data = document.to_dict(include_notes=False)
    values = _document_values(document)
    already = received.get((data["kind"], document.id), Decimal("0.00"))
    data.update(
        {
            "kind_label": DocumentKind.LABELS.get(data["kind"], data["kind"]),
            "client_name": document.client.name if document.client else None,
            "client_code": document.client.code if document.client else None,
            "nominal_value": data.get("nominal_amount"),
            "costs_value": float(values["costs"]),
            "received_total": money(already),
            "remaining_value": money(values["net"] - already),
        }
    )
    return data


def _receipt_item(receipt: Receipt, received: dict) -> dict:
    document = receipt.resolve_document()
    net = Decimal(document.net_amount or 0) if document else Decimal("0.00")
    received_total = received.get((receipt.document_kind, receipt.document_id), Decimal("0.00"))
    return {
        "id": receipt.id,
        "code": receipt.code,
        "document_kind": receipt.document_kind,
        "document_label": receipt.document_label,
        "document_id": receipt.document_id,
        "document_code": document.code if document else None,
        "client_id": receipt.client_id,
        "client": (
            {"id": receipt.client.id, "code": receipt.client.code, "name": receipt.client.name}
            if receipt.client
            else None
        ),
        "receipt_date": receipt.receipt_date.isoformat() if receipt.receipt_date else None,
        "amount": money(receipt.amount),
        "document_net": money(net),
        "received_total": money(received_total),
        "remaining_amount": money(net - received_total),
        "notes": receipt.notes,
        "created_by": receipt.created_by.name if receipt.created_by else None,
    }


# ---------------------------------------------------------------------------
# Monthly series
# ---------------------------------------------------------------------------
def _add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def _month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _month_label(key: str) -> str:
    year, month = key.split("-")
    return f"{month}/{year}"


def _month_keys(filters: dict) -> list[str]:
    today = date.today()
    end = filters["date_to"] or today
    end_year, end_month = end.year, end.month
    if filters["date_from"]:
        start_year, start_month = filters["date_from"].year, filters["date_from"].month
    elif filters["date_to"]:
        start_year, start_month = _add_months(end_year, end_month, -(MONTHLY_LIMIT - 1))
    else:
        start_year, start_month = _add_months(end_year, end_month, -(MONTHLY_LIMIT - 1))

    # Never render more than MONTHLY_LIMIT months in the chart.
    min_year, min_month = _add_months(end_year, end_month, -(MONTHLY_LIMIT - 1))
    if (start_year, start_month) < (min_year, min_month):
        start_year, start_month = min_year, min_month
    if (start_year, start_month) > (end_year, end_month):
        start_year, start_month = end_year, end_month

    keys = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = _add_months(year, month, 1)
    return keys


# ---------------------------------------------------------------------------
# Report assembly
# ---------------------------------------------------------------------------
def build_report(filters: dict) -> dict:
    # EMPRESTIMO has no documents/operations/receipts; an empty kind means all.
    include_documents = filters["kind"] in (None, DocumentKind.CHEQUE, DocumentKind.BOLETO)
    include_loans = filters["kind"] in (None, "EMPRESTIMO")

    documents = _collect_documents(filters) if include_documents else []
    received = _received_map() if include_documents else {}
    document_items = [_document_item(document, received) for document in documents]
    receipts = _collect_receipts(filters) if include_documents else []
    receipt_items = [_receipt_item(receipt, received) for receipt in receipts]
    operations = (
        [_operation_item(operation) for operation in _collect_operations(filters)]
        if include_documents
        else []
    )

    loan_filters = {**filters, "status": filters.get("loan_status")}
    loans = _collect_loans(loan_filters) if include_loans else []
    loan_items = [serialize_loan(loan, include_items=False) for loan in loans]
    installment_items = (
        [
            _installment_item(item, loan)
            for loan in loans
            for item in sorted(loan.active_installments(), key=lambda value: (value.due_date, value.number))
        ]
        if include_loans
        else []
    )

    totals = {
        "documents": len(document_items),
        "nominal": 0.0,
        "costs": 0.0,
        "net": 0.0,
        "applied_limit": 0.0,
        "open": 0.0,
        "overdue": 0.0,
        "settled": 0.0,
        "returned": 0.0,
        "cancelled": 0.0,
        "received": 0.0,
        "divergences": 0,
        "loans": len(loan_items),
        "loan_amount": 0.0,
        "loan_received": 0.0,
        "profit": 0.0,
        "loan_open": 0.0,
        "loan_divergences": 0,
        "installments": len(installment_items),
        "overdue_installments": 0,
    }
    by_kind = {
        kind: {
            "kind": kind,
            "label": label,
            "count": 0,
            "nominal": 0.0,
            "net": 0.0,
            "open": 0.0,
            "loan_amount": 0.0,
            "received_amount": 0.0,
            "profit_amount": 0.0,
        }
        for kind, label in REPORT_KIND_LABELS.items()
    }
    by_status = {
        status: {"status": status, "label": DocumentStatus.LABELS[status], "count": 0, "nominal": 0.0, "net": 0.0}
        for status in DocumentStatus.ALL
    }
    by_loan_status = {
        status: {"status": status, "label": label, "count": 0, "loan_amount": 0.0, "profit_amount": 0.0}
        for status, label in LoanStatus.LABELS.items()
    }
    per_client = defaultdict(
        lambda: {"documents": 0, "nominal": 0.0, "net": 0.0, "open": 0.0, "overdue": 0.0, "received": 0.0}
    )
    per_client_loans = defaultdict(
        lambda: {"loans": 0, "loan_amount": 0.0, "received_amount": 0.0, "profit_amount": 0.0, "installments": 0}
    )

    today = date.today()
    for item in document_items:
        values = _document_values_by_item(item)
        status = item["status"]
        totals["nominal"] += values["nominal"]
        totals["costs"] += values["costs"]
        totals["net"] += values["net"]
        totals["applied_limit"] += values["applied_limit"]
        totals["received"] += float(item.get("received_total") or 0)
        if status in DocumentStatus.PENDING:
            totals["open"] += values["net"]
        if status in DocumentStatus.PENDING and item["due_date"] and item["due_date"] < today.isoformat():
            totals["overdue"] += values["net"]
        if status == DocumentStatus.SETTLED:
            totals["settled"] += values["net"]
        if status == DocumentStatus.RETURNED:
            totals["returned"] += values["net"]
        if status == DocumentStatus.CANCELLED:
            totals["cancelled"] += values["net"]
        if item.get("has_divergence"):
            totals["divergences"] += 1

        bucket = by_kind[item["kind"]]
        bucket["count"] += 1
        bucket["nominal"] += values["nominal"]
        bucket["net"] += values["net"]
        if status in DocumentStatus.PENDING:
            bucket["open"] += values["net"]

        status_bucket = by_status[status]
        status_bucket["count"] += 1
        status_bucket["nominal"] += values["nominal"]
        status_bucket["net"] += values["net"]

        client_bucket = per_client[item["client_id"]]
        client_bucket["documents"] += 1
        client_bucket["nominal"] += values["nominal"]
        client_bucket["net"] += values["net"]
        if status in DocumentStatus.PENDING:
            client_bucket["open"] += values["net"]
        if status in DocumentStatus.PENDING and item["due_date"] and item["due_date"] < today.isoformat():
            client_bucket["overdue"] += values["net"]

    for item in receipt_items:
        if item["client_id"] in per_client:
            per_client[item["client_id"]]["received"] += float(item["amount"] or 0)

    for loan, item in zip(loans, loan_items):
        loan_amount = float(item.get("loan_amount") or 0)
        loan_received = float(item.get("received_amount") or 0)
        profit = float(item.get("profit_amount") or 0)
        loan_totals = item.get("totals") or {}
        totals["loan_amount"] += loan_amount
        totals["loan_received"] += loan_received
        totals["profit"] += profit
        totals["loan_open"] += float(loan_totals.get("open_amount") or 0)
        totals["overdue_installments"] += int(loan_totals.get("overdue_installments") or 0)
        if item.get("has_divergence"):
            totals["loan_divergences"] += 1

        bucket = by_kind["EMPRESTIMO"]
        bucket["count"] += 1
        bucket["loan_amount"] += loan_amount
        bucket["received_amount"] += loan_received
        bucket["profit_amount"] += profit

        status_bucket = by_loan_status[loan.status]
        status_bucket["count"] += 1
        status_bucket["loan_amount"] += loan_amount
        status_bucket["profit_amount"] += profit

        client_bucket = per_client_loans[loan.client_id]
        client_bucket["loans"] += 1
        client_bucket["loan_amount"] += loan_amount
        client_bucket["received_amount"] += loan_received
        client_bucket["profit_amount"] += profit
        client_bucket["installments"] += int(loan_totals.get("installments") or 0)

    clients = _client_rows(filters, per_client, per_client_loans)
    active_clients = [
        row for row in clients if row["period_documents"] or row["open_documents"] or row["period_loans"]
    ]

    monthly = _monthly_series(filters, document_items, receipt_items, loan_items)

    cards = {
        "clients_count": len(active_clients),
        "documents_count": totals["documents"],
        "nominal_total": round(totals["nominal"], 2),
        "costs_total": round(totals["costs"], 2),
        "net_total": round(totals["net"], 2),
        "applied_limit_total": round(totals["applied_limit"], 2),
        "open_total": round(totals["open"], 2),
        "overdue_total": round(totals["overdue"], 2),
        "settled_total": round(totals["settled"], 2),
        "returned_total": round(totals["returned"], 2),
        "cancelled_total": round(totals["cancelled"], 2),
        "received_total": round(totals["received"], 2),
        "divergences_count": totals["divergences"],
        "operations_count": len(operations),
        "operations_net": round(sum(float(item["totals"]["net"] or 0) for item in operations), 2),
        "receipts_count": len(receipt_items),
        "receipts_total": round(sum(float(item["amount"] or 0) for item in receipt_items), 2),
        "loans_count": totals["loans"],
        "loan_amount_total": round(totals["loan_amount"], 2),
        "loan_received_total": round(totals["loan_received"], 2),
        "profit_total": round(totals["profit"], 2),
        "loan_open_total": round(totals["loan_open"], 2),
        "loan_divergences_count": totals["loan_divergences"],
        "installments_count": totals["installments"],
        "overdue_installments": totals["overdue_installments"],
        "limits_available_total": round(sum(row["available_limit"] for row in clients), 2),
        "limits_exceeded_count": sum(1 for row in clients if row["limit_exceeded"]),
    }

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "filters": filters_as_dict(filters),
        "period_label": _period_label(filters),
        "cards": cards,
        "by_kind": list(by_kind.values()),
        "by_status": list(by_status.values()),
        "by_loan_status": list(by_loan_status.values()),
        "by_month": monthly,
        "clients": clients,
        "documents": document_items,
        "operations": operations,
        "receipts": receipt_items,
        "loans": loan_items,
        "installments": installment_items,
        "counts": {
            "clients": len(clients),
            "documents": len(document_items),
            "operations": len(operations),
            "receipts": len(receipt_items),
            "loans": len(loan_items),
            "installments": len(installment_items),
        },
    }


def _operation_item(operation: Operation) -> dict:
    data = operation.to_dict(include_items=False)
    data["client_name"] = operation.client.name if operation.client else None
    data["client_code"] = operation.client.code if operation.client else None
    return data


def _document_values_by_item(item: dict) -> dict:
    nominal = float(item.get("nominal_amount") or 0)
    discount = float(item.get("discount_amount") or 0)
    interest = float(item.get("interest_amount") or 0)
    expenses = float(item.get("other_expenses") or 0)
    net = float(item.get("net_amount") or 0)
    applied = float(item.get("applied_limit") or 0)
    return {
        "nominal": nominal,
        "costs": discount + interest + expenses,
        "net": net,
        "applied_limit": applied,
    }


def _client_rows(filters: dict, per_client: dict, per_client_loans: dict | None = None) -> list[dict]:
    query = Client.query.filter(Client.is_deleted.is_(False))
    if filters["client_id"]:
        query = query.filter(Client.id == filters["client_id"])
    clients = query.order_by(Client.name.asc()).limit(MAX_EXPORT_ROWS).all()
    exposure = exposure_map([client.id for client in clients])

    rows = []
    for client in clients:
        limit = Decimal(client.operational_limit or 0)
        exposure_row = exposure.get(client.id, {})
        open_amount = Decimal(exposure_row.get("open_amount") or 0)
        available = limit - open_amount
        period = per_client.get(client.id, {})
        loan_period = (per_client_loans or {}).get(client.id, {})
        rows.append(
            {
                "id": client.id,
                "code": client.code,
                "name": client.name,
                "document": client.document,
                "person_type": client.person_type,
                "status": client.status,
                "status_label": client.status_label,
                "phone": client.phone,
                "whatsapp": client.whatsapp,
                "operational_limit": money(limit),
                "open_amount": money(open_amount),
                "overdue_amount": money(exposure_row.get("overdue_amount") or 0),
                "open_documents": exposure_row.get("open_documents", 0),
                "overdue_documents": exposure_row.get("overdue_documents", 0),
                "available_limit": money(available),
                "limit_usage_percent": (
                    float((open_amount / limit * 100).quantize(Decimal("0.01"))) if limit > 0 else None
                ),
                "limit_exceeded": bool(limit > 0 and open_amount > limit),
                "period_documents": period.get("documents", 0),
                "period_nominal": round(period.get("nominal", 0.0), 2),
                "period_net": round(period.get("net", 0.0), 2),
                "period_open": round(period.get("open", 0.0), 2),
                "period_overdue": round(period.get("overdue", 0.0), 2),
                "period_received": round(period.get("received", 0.0), 2),
                "period_loans": loan_period.get("loans", 0),
                "period_loan_amount": round(loan_period.get("loan_amount", 0.0), 2),
                "period_loan_received": round(loan_period.get("received_amount", 0.0), 2),
                "period_profit": round(loan_period.get("profit_amount", 0.0), 2),
                "period_installments": loan_period.get("installments", 0),
            }
        )
    rows.sort(
        key=lambda row: (
            -(row["period_net"] + row["period_loan_amount"]),
            -row["open_amount"],
            row["name"],
        )
    )
    return rows


def _monthly_series(filters: dict, documents: list[dict], receipts: list[dict], loans: list[dict] | None = None) -> list[dict]:
    keys = _month_keys(filters)
    index = {
        key: {
            "month": key,
            "label": _month_label(key),
            "documents": 0,
            "nominal": 0.0,
            "net": 0.0,
            "received": 0.0,
            "receipts": 0,
            "loans": 0,
            "loan_amount": 0.0,
            "loan_received": 0.0,
            "profit_amount": 0.0,
        }
        for key in keys
    }
    for item in documents:
        value = item.get("operation_date")
        if not value:
            continue
        key = value[:7]
        if key not in index:
            continue
        bucket = index[key]
        bucket["documents"] += 1
        bucket["nominal"] += float(item.get("nominal_amount") or 0)
        bucket["net"] += float(item.get("net_amount") or 0)
    for item in receipts:
        value = item.get("receipt_date")
        if not value:
            continue
        key = value[:7]
        if key not in index:
            continue
        bucket = index[key]
        bucket["receipts"] += 1
        bucket["received"] += float(item.get("amount") or 0)
    for item in loans or []:
        value = item.get("loan_date")
        if not value:
            continue
        key = value[:7]
        if key not in index:
            continue
        bucket = index[key]
        bucket["loans"] += 1
        bucket["loan_amount"] += float(item.get("loan_amount") or 0)
        bucket["loan_received"] += float(item.get("received_amount") or 0)
        bucket["profit_amount"] += float(item.get("profit_amount") or 0)
    return [
        {
            **bucket,
            "nominal": round(bucket["nominal"], 2),
            "net": round(bucket["net"], 2),
            "received": round(bucket["received"], 2),
            "loan_amount": round(bucket["loan_amount"], 2),
            "loan_received": round(bucket["loan_received"], 2),
            "profit_amount": round(bucket["profit_amount"], 2),
        }
        for bucket in index.values()
    ]


def _period_label(filters: dict) -> str:
    start, end = filters["date_from"], filters["date_to"]
    if start and end:
        return f"{_date_br(start)} a {_date_br(end)}"
    if start:
        return f"A partir de {_date_br(start)}"
    if end:
        return f"Até {_date_br(end)}"
    return "Todo o período"


def _date_br(value) -> str:
    if not value:
        return "—"
    if isinstance(value, str):
        value = date.fromisoformat(value[:10])
    return value.strftime("%d/%m/%Y")


# ---------------------------------------------------------------------------
# WhatsApp
# ---------------------------------------------------------------------------
def build_whatsapp(client_id: int, filters: dict) -> dict:
    from ..api.settings import get_company_settings

    client = db.session.get(Client, client_id)
    if not client or client.is_deleted:
        raise ValidationError({"client_id": "Cliente não encontrado."})

    today = date.today()
    query_common = dict(is_deleted=False, client_id=client_id)
    include_documents = filters.get("kind") in (None, DocumentKind.CHEQUE, DocumentKind.BOLETO)
    include_loans = filters.get("kind") in (None, "EMPRESTIMO")

    documents = []
    if include_documents:
        for model, kind in ((Cheque, DocumentKind.CHEQUE), (Boleto, DocumentKind.BOLETO)):
            if filters.get("kind") and filters["kind"] != kind:
                continue
            query = model.query.filter_by(**query_common).filter(model.status.in_(DocumentStatus.PENDING))
            if filters.get("overdue"):
                query = query.filter(model.due_date < today)
            documents.extend(query.all())
        documents.sort(key=lambda doc: (doc.due_date or date.max, doc.code))

    installments = []
    if include_loans:
        loan_filters = {**filters, "status": filters.get("loan_status")}
        for loan in _collect_loans(loan_filters):
            for item in loan.active_installments():
                if item.status not in DocumentStatus.PENDING:
                    continue
                if filters.get("overdue") and (not item.due_date or item.due_date >= today):
                    continue
                installments.append((loan, item))
        installments.sort(key=lambda pair: (pair[1].due_date or date.max, pair[0].code))

    received = _received_map()
    shown_documents = documents[:20]
    shown_installments = installments[:20]
    lines = []
    for document in shown_documents:
        already = received.get((document.__class__.__name__.upper(), document.id), Decimal("0.00"))
        remaining = Decimal(document.net_amount or 0) - already
        lines.append(
            f"• {document.code} — venc. {_date_br(document.due_date)} — {format_brl(remaining)}"
        )
    for loan, item in shown_installments:
        lines.append(
            f"• {loan.code} · {item.number}ª parcela — venc. {_date_br(item.due_date)} — "
            f"{format_brl(item.amount)}"
        )
    hidden = len(documents) - len(shown_documents) + len(installments) - len(shown_installments)
    if hidden > 0:
        lines.append(f"… e mais {hidden} registro(s).")

    total = Decimal("0.00")
    for document in documents:
        already = received.get((document.__class__.__name__.upper(), document.id), Decimal("0.00"))
        total += Decimal(document.net_amount or 0) - already
    for _, item in installments:
        total += Decimal(item.amount or 0)

    company = get_company_settings()
    signature = (company.get("company_signature") or "").strip()
    first_name = (client.name or "").split(" ")[0]
    header = f"Olá, {first_name}! Aqui é {company.get('company_name') or 'FACTOR PRO'}."
    body = (
        f"Segue o resumo dos valores em aberto de {client.name} "
        f"({client.code}) em {_date_br(today)}:"
    )
    if lines:
        title = "Valores em aberto:"
        closing = f"Total em aberto: {format_brl(total)}"
    else:
        title = "Não encontrei valores em aberto para este cliente."
        closing = ""

    message = "\n\n".join(
        part
        for part in (
            header,
            body,
            "\n".join([title, *lines]) if title else "",
            closing,
            signature,
        )
        if part
    )

    digits = "".join(ch for ch in (client.whatsapp or client.phone or "") if ch.isdigit())
    if digits and len(digits) in (10, 11):
        digits = f"55{digits}"
    url = f"https://wa.me/{digits}?text={quote(message)}" if digits else None

    return {
        "client": {"id": client.id, "code": client.code, "name": client.name},
        "company": company,
        "message": message,
        "phone": digits or None,
        "url": url,
        "documents_count": len(documents),
        "loans_count": len({loan.id for loan, _ in installments}),
        "installments_count": len(installments),
        "total": money(total),
        "documents": [
            {
                "id": document.id,
                "kind": document.__class__.__name__.upper(),
                "code": document.code,
                "due_date": document.due_date.isoformat() if document.due_date else None,
                "net_amount": money(document.net_amount),
            }
            for document in documents
        ],
        "installments": [
            {
                "id": item.id,
                "loan_code": loan.code,
                "number": item.number,
                "due_date": item.due_date.isoformat() if item.due_date else None,
                "amount": money(item.amount),
            }
            for loan, item in installments
        ],
    }


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------
def export_filename(extension: str, company: dict | None = None) -> str:
    from .branding import export_slug

    return f"relatorio-{export_slug(company)}-{datetime.now():%Y%m%d-%H%M}.{extension}"


def audit_export(user, file_format: str, report: dict) -> None:
    log_action(
        AuditAction.EXPORT,
        "report",
        None,
        f"Relatório exportado em {file_format.upper()}",
        changes={"format": file_format.upper(), "filters": report["filters"]},
        user=user,
        commit=True,
    )


def render_pdf(report: dict, company: dict, user) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import (
        Image,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    company_name = company_display_name(company)
    display_name = app_display_name(company)
    logo_path = brand_logo_path(company)
    logo_size = None
    if logo_path:
        try:
            logo_size = ImageReader(logo_path).getSize()
        except Exception:  # pragma: no cover - unreadable logo falls back to text
            logo_path = None

    buffer = BytesIO()
    page_size = landscape(A4)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page_size,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=20 * mm,
        title=f"Relatório — {company_name}",
        author=company_name,
    )
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("FpNormal", parent=styles["Normal"], fontName="Helvetica", fontSize=8, leading=10)
    small = ParagraphStyle("FpSmall", parent=normal, fontSize=7, leading=9)
    right = ParagraphStyle("FpRight", parent=normal, alignment=2)
    right_small = ParagraphStyle("FpRightSmall", parent=small, alignment=2)
    heading = ParagraphStyle(
        "FpHeading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11, leading=14, spaceBefore=4, spaceAfter=4
    )
    brand = ParagraphStyle("FpBrand", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=17, leading=20)
    subtitle = ParagraphStyle("FpSubtitle", parent=normal, fontSize=9, textColor=colors.HexColor("#3B4F48"))
    strong_right = ParagraphStyle("FpStrongRight", parent=normal, fontName="Helvetica-Bold", alignment=2)

    green = colors.HexColor("#123D32")
    green_light = colors.HexColor("#DDF4E8")
    petroleum = colors.HexColor("#173B57")
    grid = colors.HexColor("#D7E2DD")
    muted = colors.HexColor("#5A6B64")
    danger = colors.HexColor("#C9463D")

    story = []
    if logo_path and logo_size:
        try:
            logo_height = 18 * mm
            logo_width = logo_height * logo_size[0] / logo_size[1]
            story.append(Image(logo_path, width=logo_width, height=logo_height))
            story.append(Spacer(1, 4))
        except Exception:  # pragma: no cover - never break an export for a logo
            pass
    story.append(Paragraph(escape(company_name), brand))
    contact_bits = [
        company.get("company_document"),
        company.get("company_phone"),
        company.get("company_email"),
        " · ".join(
            part for part in (company.get("company_city"), company.get("company_state")) if part
        ),
    ]
    contact_line = " · ".join(str(bit) for bit in contact_bits if bit)
    if contact_line:
        story.append(Paragraph(escape(contact_line), subtitle))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Relatório da carteira", heading))
    emitted = f"Emitido em {datetime.now():%d/%m/%Y %H:%M}"
    if user is not None and getattr(user, "name", None):
        emitted += f" por {user.name}"
    story.append(Paragraph(escape(f"Período: {report['period_label']} · {emitted}"), subtitle))
    story.append(Spacer(1, 8))

    cards = report["cards"]
    metrics = [
        ("Títulos", f"{cards['documents_count']}"),
        ("Valor nominal", format_brl(cards["nominal_total"])),
        ("Custos informados", format_brl(cards["costs_total"])),
        ("Valor líquido", format_brl(cards["net_total"])),
        ("Em aberto", format_brl(cards["open_total"])),
        ("Vencidos", format_brl(cards["overdue_total"])),
        ("Recebido no período", format_brl(cards["receipts_total"])),
        ("Operações", f"{cards['operations_count']}"),
        ("Empréstimos", f"{cards['loans_count']}"),
        ("Valor emprestado", format_brl(cards["loan_amount_total"])),
        ("Lucro informado", format_brl(cards["profit_total"])),
        ("Parcelas", f"{cards['installments_count']}"),
    ]
    metric_cells = [
        [
            Paragraph(f"<font size=7 color='#5A6B64'>{escape(label)}</font><br/><b>{escape(value)}</b>", normal)
            for label, value in metrics[row : row + 4]
        ]
        for row in range(0, len(metrics), 4)
    ]
    summary_table = Table(metric_cells, colWidths=[(page_size[0] - 24 * mm) / 4] * 4)
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), green_light),
                ("BOX", (0, 0), (-1, -1), 0.5, grid),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.white),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(summary_table)
    story.append(Spacer(1, 10))

    def header_row(labels):
        return [Paragraph(f"<b>{escape(label)}</b>", small) for label in labels]

    def table_style():
        return TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), green),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.35, grid),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F7F6")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )

    def money_paragraph(value, style=right_small):
        return Paragraph(escape(format_brl(value)), style)

    # Clients / limits -------------------------------------------------------
    story.append(Paragraph("Clientes e limites", heading))
    rows = [header_row(["Cliente", "Títulos", "Nominal", "Líquido", "Em aberto", "Limite", "Disponível"])]
    for row in report["clients"]:
        if not (row["period_documents"] or row["open_documents"]):
            continue
        name = f"<b>{escape(row['name'])}</b> <font size=6 color='#5A6B64'>{escape(row['code'])}</font>"
        available_style = right_small
        rows.append(
            [
                Paragraph(name, small),
                Paragraph(str(row["period_documents"]), small),
                money_paragraph(row["period_nominal"]),
                money_paragraph(row["period_net"]),
                money_paragraph(row["open_amount"]),
                money_paragraph(row["operational_limit"]),
                Paragraph(escape(format_brl(row["available_limit"])), available_style),
            ]
        )
    if len(rows) == 1:
        rows.append([Paragraph("Nenhum cliente com movimento ou saldo em aberto no período.", small), "", "", "", "", "", ""])
    client_table = Table(
        rows,
        colWidths=[70 * mm, 16 * mm, 32 * mm, 32 * mm, 32 * mm, 32 * mm, 32 * mm],
        repeatRows=1,
    )
    client_table.setStyle(table_style())
    story.append(client_table)
    story.append(Spacer(1, 10))

    # Documents --------------------------------------------------------------
    story.append(Paragraph("Títulos", heading))
    rows = [
        header_row(["Título", "Tipo", "Cliente", "Vencimento", "Situação", "Nominal", "Líquido"])
    ]
    limited = report["documents"][:PDF_ROW_LIMIT]
    for item in limited:
        rows.append(
            [
                Paragraph(escape(item["code"]), small),
                Paragraph(escape(item["kind_label"]), small),
                Paragraph(escape(item.get("client_name") or "—"), small),
                Paragraph(escape(_date_br(item["due_date"])), small),
                Paragraph(escape(item["status_label"]), small),
                money_paragraph(item.get("nominal_amount")),
                money_paragraph(item.get("net_amount")),
            ]
        )
    if len(rows) == 1:
        rows.append([Paragraph("Nenhum título encontrado com os filtros informados.", small), "", "", "", "", "", ""])
    document_table = Table(
        rows,
        colWidths=[26 * mm, 18 * mm, 75 * mm, 22 * mm, 24 * mm, 34 * mm, 34 * mm],
        repeatRows=1,
    )
    document_table.setStyle(table_style())
    story.append(document_table)
    if len(report["documents"]) > len(limited):
        story.append(
            Paragraph(
                f"Exibindo os primeiros {len(limited)} de {len(report['documents'])} títulos. "
                "A planilha contém a lista completa.",
                small,
            )
        )

    # Empréstimos e parcelas --------------------------------------------------
    if report["loans"] or report["installments"]:
        story.append(PageBreak())
        story.append(Paragraph("Empréstimos", heading))
        rows = [
            header_row(["Empréstimo", "Cliente", "Data", "Emprestado", "Recebido", "Lucro", "Situação"])
        ]
        for item in report["loans"][:PDF_ROW_LIMIT]:
            client_name = (item.get("client") or {}).get("name") or "—"
            rows.append(
                [
                    Paragraph(escape(item["code"]), small),
                    Paragraph(escape(client_name), small),
                    Paragraph(escape(_date_br(item.get("loan_date"))), small),
                    money_paragraph(item.get("loan_amount")),
                    money_paragraph(item.get("received_amount")),
                    money_paragraph(item.get("profit_amount")),
                    Paragraph(escape(item.get("status_label") or item.get("status") or "—"), small),
                ]
            )
        if len(rows) == 1:
            rows.append([Paragraph("Nenhum empréstimo encontrado com os filtros informados.", small), "", "", "", "", "", ""])
        loan_table = Table(
            rows,
            colWidths=[26 * mm, 68 * mm, 22 * mm, 34 * mm, 34 * mm, 30 * mm, 25 * mm],
            repeatRows=1,
        )
        loan_table.setStyle(table_style())
        story.append(loan_table)
        story.append(Spacer(1, 10))

        story.append(Paragraph("Parcelas", heading))
        rows = [
            header_row(["Empréstimo", "Cliente", "Parcela", "Vencimento", "Valor", "Situação"])
        ]
        for item in report["installments"][:PDF_ROW_LIMIT]:
            rows.append(
                [
                    Paragraph(escape(item.get("loan_code") or "—"), small),
                    Paragraph(escape(item.get("client_name") or "—"), small),
                    Paragraph(str(item.get("number") or ""), small),
                    Paragraph(escape(_date_br(item.get("due_date"))), small),
                    money_paragraph(item.get("amount")),
                    Paragraph(escape(item.get("status_label") or item.get("status") or "—"), small),
                ]
            )
        if len(rows) == 1:
            rows.append([Paragraph("Nenhuma parcela encontrada com os filtros informados.", small), "", "", "", "", ""])
        installment_table = Table(
            rows,
            colWidths=[30 * mm, 85 * mm, 20 * mm, 28 * mm, 40 * mm, 36 * mm],
            repeatRows=1,
        )
        installment_table.setStyle(table_style())
        story.append(installment_table)
        story.append(
            Paragraph(
                "Valores de empréstimo, recebido e lucro são informados pelo usuário; o sistema não calcula juros ou encargos.",
                small,
            )
        )

    if report["operations"] or report["receipts"]:
        story.append(PageBreak())
        story.append(Paragraph("Operações", heading))
        rows = [header_row(["Código", "Cliente", "Data", "Docs.", "Nominal", "Líquido", "Situação"])]
        for item in report["operations"][:PDF_ROW_LIMIT]:
            rows.append(
                [
                    Paragraph(escape(item["code"]), small),
                    Paragraph(escape(item.get("client_name") or "—"), small),
                    Paragraph(escape(_date_br(item["operation_date"])), small),
                    Paragraph(str(item.get("documents_count", 0)), small),
                    money_paragraph(item["totals"].get("nominal")),
                    money_paragraph(item["totals"].get("net")),
                    Paragraph(escape(item.get("status_label") or item.get("status") or "—"), small),
                ]
            )
        if len(rows) == 1:
            rows.append([Paragraph("Nenhuma operação no período.", small), "", "", "", "", "", ""])
        operation_table = Table(rows, colWidths=[24 * mm, 75 * mm, 22 * mm, 16 * mm, 36 * mm, 36 * mm, 30 * mm], repeatRows=1)
        operation_table.setStyle(table_style())
        story.append(operation_table)
        story.append(Spacer(1, 10))

        story.append(Paragraph("Recebimentos", heading))
        rows = [header_row(["Código", "Título", "Cliente", "Data", "Valor recebido"])]
        for item in report["receipts"][:PDF_ROW_LIMIT]:
            rows.append(
                [
                    Paragraph(escape(item["code"]), small),
                    Paragraph(escape(item.get("document_code") or "—"), small),
                    Paragraph(escape((item.get("client") or {}).get("name") or "—"), small),
                    Paragraph(escape(_date_br(item["receipt_date"])), small),
                    money_paragraph(item.get("amount")),
                ]
            )
        if len(rows) == 1:
            rows.append([Paragraph("Nenhum recebimento no período.", small), "", "", "", ""])
        receipt_table = Table(rows, colWidths=[24 * mm, 26 * mm, 95 * mm, 24 * mm, 38 * mm], repeatRows=1)
        receipt_table.setStyle(table_style())
        story.append(receipt_table)

    def footer(canvas, document):
        canvas.saveState()
        text_x = 12 * mm
        if logo_path and logo_size:
            try:
                logo_height = 8 * mm
                logo_width = min(logo_height * logo_size[0] / logo_size[1], 40 * mm)
                canvas.drawImage(
                    logo_path,
                    12 * mm,
                    10 * mm,
                    width=logo_width,
                    height=logo_height,
                    preserveAspectRatio=True,
                    anchor="sw",
                    mask="auto",
                )
                text_x += logo_width + 4 * mm
            except Exception:  # pragma: no cover - never break an export for a logo
                pass
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(muted)
        canvas.drawString(
            text_x, 8 * mm, f"{display_name} · Relatório gerado em {datetime.now():%d/%m/%Y %H:%M}"
        )
        canvas.drawRightString(page_size[0] - 12 * mm, 8 * mm, f"Página {document.page}")
        canvas.setStrokeColor(grid)
        canvas.line(12 * mm, 19 * mm, page_size[0] - 12 * mm, 19 * mm)
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def render_xlsx(report: dict, company: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.drawing.image import Image as XLImage
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    company_name = company_display_name(company)
    logo_path = brand_logo_path(company)

    def add_logo(ws, anchor: str = "D1") -> None:
        if not logo_path:
            return
        try:
            image = XLImage(logo_path)
            image.width = min(image.width, 220)
            image.height = min(image.height, 64)
            ws.add_image(image, anchor)
        except Exception:  # pragma: no cover - never break an export for a logo
            pass

    wb = Workbook()
    header_fill = PatternFill("solid", fgColor="123D32")
    header_font = Font(color="FFFFFF", bold=True)
    title_font = Font(bold=True, size=14, color="123D32")
    bold = Font(bold=True)
    thin = Side(style="thin", color="D7E2DD")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    money_format = 'R$ #,##0.00'
    percent_format = '0.00"%"'

    def style_header(ws, row=1):
        for cell in ws[row]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(vertical="center")
            cell.border = border

    def widths(ws, values):
        for index, width in enumerate(values, start=1):
            ws.column_dimensions[get_column_letter(index)].width = width

    def write_rows(ws, start_row, rows, money_columns=(), percent_columns=()):
        for offset, row in enumerate(rows):
            for column, value in enumerate(row, start=1):
                cell = ws.cell(row=start_row + offset, column=column, value=value)
                cell.border = border
                if column in money_columns and isinstance(value, (int, float)):
                    cell.number_format = money_format
                if column in percent_columns and isinstance(value, (int, float)):
                    cell.number_format = percent_format

    # Resumo ---------------------------------------------------------------
    ws = wb.active
    ws.title = "Resumo"
    ws["A1"] = company_name
    ws["A1"].font = title_font
    add_logo(ws, "D1")
    ws["A2"] = "Relatório da carteira"
    ws["A2"].font = bold
    ws["A3"] = f"Período: {report['period_label']}"
    ws["A4"] = f"Gerado em: {datetime.now():%d/%m/%Y %H:%M}"
    cards = report["cards"]
    summary_rows = [
        ("Títulos", cards["documents_count"]),
        ("Valor nominal", cards["nominal_total"]),
        ("Custos informados", cards["costs_total"]),
        ("Valor líquido", cards["net_total"]),
        ("Limite aplicado", cards["applied_limit_total"]),
        ("Em aberto", cards["open_total"]),
        ("Vencidos", cards["overdue_total"]),
        ("Liquidados", cards["settled_total"]),
        ("Devolvidos", cards["returned_total"]),
        ("Cancelados", cards["cancelled_total"]),
        ("Recebido no período", cards["receipts_total"]),
        ("Recebimentos", cards["receipts_count"]),
        ("Operações", cards["operations_count"]),
        ("Clientes com movimento", cards["clients_count"]),
        ("Divergências", cards["divergences_count"]),
        ("Limite disponível (clientes)", cards["limits_available_total"]),
        ("Clientes acima do limite", cards["limits_exceeded_count"]),
        ("Empréstimos", cards["loans_count"]),
        ("Valor emprestado", cards["loan_amount_total"]),
        ("Recebido dos empréstimos", cards["loan_received_total"]),
        ("Lucro informado", cards["profit_total"]),
        ("Saldo em aberto dos empréstimos", cards["loan_open_total"]),
        ("Parcelas", cards["installments_count"]),
        ("Parcelas vencidas", cards["overdue_installments"]),
        ("Empréstimos divergentes", cards["loan_divergences_count"]),
    ]
    ws["A6"] = "Indicador"
    ws["B6"] = "Valor"
    style_header(ws, 6)
    for offset, (label, value) in enumerate(summary_rows, start=7):
        ws.cell(row=offset, column=1, value=label).border = border
        cell = ws.cell(row=offset, column=2, value=value)
        cell.border = border
        if isinstance(value, float):
            cell.number_format = money_format
    widths(ws, [34, 22])

    # Clientes -------------------------------------------------------------
    ws = wb.create_sheet("Clientes")
    headers = [
        "Código", "Cliente", "Documento", "Situação", "Limite operacional", "Em aberto",
        "Disponível", "Uso do limite (%)", "Vencidos", "Títulos no período", "Nominal no período",
        "Líquido no período", "Recebido no período", "Telefone/WhatsApp",
    ]
    ws.append(headers)
    style_header(ws)
    rows = [
        [
            row["code"], row["name"], row["document"], row["status_label"], row["operational_limit"],
            row["open_amount"], row["available_limit"], row["limit_usage_percent"],
            row["overdue_amount"], row["period_documents"], row["period_nominal"],
            row["period_net"], row["period_received"], row["whatsapp"] or row["phone"] or "",
        ]
        for row in report["clients"]
    ]
    write_rows(ws, 2, rows, money_columns=(5, 6, 7, 9, 11, 12, 13), percent_columns=(8,))
    for offset, row in enumerate(report["clients"], start=2):
        if row["limit_exceeded"]:
            ws.cell(row=offset, column=7).font = Font(color="C9463D", bold=True)
    widths(ws, [12, 40, 20, 12, 18, 15, 15, 14, 15, 16, 18, 18, 18, 20])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:N{max(len(rows) + 1, 1)}"

    # Documentos -----------------------------------------------------------
    ws = wb.create_sheet("Documentos")
    headers = [
        "Título", "Tipo", "Cliente", "Código do cliente", "Vencimento", "Operação",
        "Emissão", "Situação", "Nominal", "Desconto", "Juros", "Despesas", "Líquido",
        "Limite aplicado", "Recebido", "Saldo", "Divergente", "Operação vinculada",
    ]
    ws.append(headers)
    style_header(ws)
    rows = [
        [
            item["code"], item["kind_label"], item.get("client_name") or "", item.get("client_code") or "",
            _date_br(item["due_date"]), _date_br(item.get("operation_date")), _date_br(item.get("issue_date")),
            item["status_label"], item.get("nominal_amount") or 0, item.get("discount_amount") or 0,
            item.get("interest_amount") or 0, item.get("other_expenses") or 0, item.get("net_amount") or 0,
            item.get("applied_limit") or 0, item.get("received_total") or 0, item.get("remaining_value") or 0,
            "Sim" if item.get("has_divergence") else "Não", (item.get("operation") or {}).get("code") or "",
        ]
        for item in report["documents"]
    ]
    write_rows(ws, 2, rows, money_columns=(9, 10, 11, 12, 13, 14, 15, 16))
    widths(ws, [14, 10, 38, 16, 12, 12, 12, 12, 15, 12, 12, 12, 15, 16, 15, 15, 11, 14])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:R{max(len(rows) + 1, 1)}"

    # Operações ------------------------------------------------------------
    ws = wb.create_sheet("Operações")
    headers = ["Código", "Cliente", "Data", "Documentos", "Nominal", "Custos", "Líquido", "Limite aplicado", "Situação"]
    ws.append(headers)
    style_header(ws)
    rows = [
        [
            item["code"], item.get("client_name") or "", _date_br(item["operation_date"]),
            item.get("documents_count", 0), item["totals"].get("nominal") or 0,
            item["totals"].get("costs") or 0, item["totals"].get("net") or 0,
            item["totals"].get("applied_limit") or 0, item.get("status_label") or item.get("status"),
        ]
        for item in report["operations"]
    ]
    write_rows(ws, 2, rows, money_columns=(5, 6, 7, 8))
    widths(ws, [14, 40, 12, 13, 16, 16, 16, 16, 12])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:I{max(len(rows) + 1, 1)}"

    # Recebimentos ---------------------------------------------------------
    ws = wb.create_sheet("Recebimentos")
    headers = ["Código", "Título", "Tipo", "Cliente", "Data", "Valor recebido", "Líquido do título", "Saldo", "Observações"]
    ws.append(headers)
    style_header(ws)
    rows = [
        [
            item["code"], item.get("document_code") or "", item["document_label"],
            (item.get("client") or {}).get("name") or "", _date_br(item["receipt_date"]),
            item.get("amount") or 0, item.get("document_net") or 0, item.get("remaining_amount") or 0,
            item.get("notes") or "",
        ]
        for item in report["receipts"]
    ]
    write_rows(ws, 2, rows, money_columns=(6, 7, 8))
    widths(ws, [14, 14, 10, 40, 12, 17, 17, 15, 45])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:I{max(len(rows) + 1, 1)}"

    # Empréstimos -----------------------------------------------------------
    ws = wb.create_sheet("Empréstimos")
    headers = [
        "Empréstimo", "Cliente", "Data", "Valor emprestado", "Valor recebido", "Lucro informado",
        "Situação", "Divergente", "Parcelas", "Observações",
    ]
    ws.append(headers)
    style_header(ws)
    add_logo(ws, "L1")
    rows = [
        [
            item["code"], (item.get("client") or {}).get("name") or "", _date_br(item.get("loan_date")),
            item.get("loan_amount") or 0, item.get("received_amount") or 0, item.get("profit_amount") or 0,
            item.get("status_label") or item.get("status") or "", "Sim" if item.get("has_divergence") else "Não",
            (item.get("totals") or {}).get("installments", 0), item.get("notes") or "",
        ]
        for item in report["loans"]
    ]
    write_rows(ws, 2, rows, money_columns=(4, 5, 6))
    widths(ws, [14, 40, 12, 18, 18, 18, 12, 12, 10, 45])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:J{max(len(rows) + 1, 1)}"

    # Parcelas --------------------------------------------------------------
    ws = wb.create_sheet("Parcelas")
    headers = ["Empréstimo", "Cliente", "Parcela", "Vencimento", "Valor", "Situação", "Vencida", "Observações"]
    ws.append(headers)
    style_header(ws)
    add_logo(ws, "I1")
    rows = [
        [
            item.get("loan_code") or "", item.get("client_name") or "", item.get("number"),
            _date_br(item.get("due_date")), item.get("amount") or 0, item.get("status_label") or item.get("status") or "",
            "Sim" if item.get("is_overdue") else "Não", item.get("notes") or "",
        ]
        for item in report["installments"]
    ]
    write_rows(ws, 2, rows, money_columns=(5,))
    widths(ws, [14, 40, 10, 14, 18, 14, 10, 45])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:H{max(len(rows) + 1, 1)}"

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
