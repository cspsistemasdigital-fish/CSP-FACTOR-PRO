"""Dashboard aggregations (Etapa 1 scope: clients, cheques and boletos).

Receipts / realised gains will be added in Etapa 2/3. Nothing here invents
data: every number is derived from records created by the user.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func

from ..extensions import db
from ..models import Boleto, Cheque, Client, ClientStatus, DocumentStatus, Operation, Receipt
from .clients import exposure_map


def _month_keys(today: date, date_from: date | None, date_to: date | None, limit: int = 12) -> list[str]:
    def add_months(year: int, month: int, delta: int) -> tuple[int, int]:
        index = year * 12 + (month - 1) + delta
        return index // 12, index % 12 + 1

    end_year, end_month = (date_to or today).year, (date_to or today).month
    if date_from:
        start_year, start_month = date_from.year, date_from.month
    else:
        start_year, start_month = add_months(end_year, end_month, -(limit - 1))
    minimum = add_months(end_year, end_month, -(limit - 1))
    if (start_year, start_month) < minimum:
        start_year, start_month = minimum
    if (start_year, start_month) > (end_year, end_month):
        start_year, start_month = end_year, end_month
    keys = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = add_months(year, month, 1)
    return keys


def _top_clients(limit: int = 6) -> list[dict]:
    """Clients with the largest open exposure (all-time, derived from net values)."""
    totals: dict[int, dict] = {}
    for model in (Cheque, Boleto):
        rows = (
            db.session.query(
                model.client_id,
                func.coalesce(func.sum(model.net_amount), 0),
                func.count(model.id),
            )
            .filter(model.is_deleted.is_(False), model.status.in_(DocumentStatus.PENDING))
            .group_by(model.client_id)
            .all()
        )
        for client_id, total, count in rows:
            bucket = totals.setdefault(client_id, {"open": Decimal("0.00"), "documents": 0})
            bucket["open"] += Decimal(total or 0)
            bucket["documents"] += count
    if not totals:
        return []
    ranked = sorted(totals.items(), key=lambda item: item[1]["open"], reverse=True)[:limit]
    clients = {client.id: client for client in Client.query.filter(Client.id.in_([cid for cid, _ in ranked])).all()}
    exposure = exposure_map([cid for cid, _ in ranked])
    result = []
    for client_id, bucket in ranked:
        client = clients.get(client_id)
        if not client or client.is_deleted:
            continue
        limit_value = Decimal(client.operational_limit or 0)
        open_amount = Decimal(bucket["open"])
        result.append(
            {
                "id": client.id,
                "code": client.code,
                "name": client.name,
                "status": client.status,
                "status_label": client.status_label,
                "open_amount": float(open_amount.quantize(Decimal("0.01"))),
                "open_documents": bucket["documents"],
                "overdue_amount": float(Decimal(exposure.get(client_id, {}).get("overdue_amount") or 0)),
                "operational_limit": float(limit_value.quantize(Decimal("0.01"))),
                "available_limit": float((limit_value - open_amount).quantize(Decimal("0.01"))),
                "limit_exceeded": bool(limit_value > 0 and open_amount > limit_value),
            }
        )
    return result


def _sum(query, column):
    value = query.with_entities(func.coalesce(func.sum(column), 0)).scalar()
    return Decimal(value or 0)


def build_dashboard(date_from: date | None, date_to: date | None, client_id: int | None) -> dict:
    today = date.today()
    horizon = today + timedelta(days=30)

    def scoped(model):
        q = model.query.filter(model.is_deleted.is_(False))
        if date_from:
            q = q.filter(model.operation_date >= date_from)
        if date_to:
            q = q.filter(model.operation_date <= date_to)
        if client_id:
            q = q.filter(model.client_id == client_id)
        return q

    cheque_q = scoped(Cheque)
    boleto_q = scoped(Boleto)

    receipt_q = Receipt.query.filter(Receipt.is_deleted.is_(False))
    operation_q = Operation.query.filter(Operation.is_deleted.is_(False))
    if date_from:
        receipt_q = receipt_q.filter(Receipt.receipt_date >= date_from)
        operation_q = operation_q.filter(Operation.operation_date >= date_from)
    if date_to:
        receipt_q = receipt_q.filter(Receipt.receipt_date <= date_to)
        operation_q = operation_q.filter(Operation.operation_date <= date_to)
    if client_id:
        receipt_q = receipt_q.filter(Receipt.client_id == client_id)
        operation_q = operation_q.filter(Operation.client_id == client_id)

    clients_query = Client.query.filter(Client.is_deleted.is_(False))
    clients_total = clients_query.count()
    clients_active = clients_query.filter(Client.status == ClientStatus.ACTIVE).count()

    operations_total = cheque_q.count() + boleto_q.count()
    cheques_nominal = _sum(cheque_q, Cheque.nominal_amount)
    boletos_nominal = _sum(boleto_q, Boleto.original_amount)

    cheques_net = _sum(cheque_q, Cheque.net_amount)
    boletos_net = _sum(boleto_q, Boleto.net_amount)
    paid_total = cheques_net + boletos_net

    # Registered gains = informed costs (never automatically calculated fees).
    # Cancelled documents do not generate gains.
    cheque_gains = (
        _sum(cheque_q.filter(Cheque.status != DocumentStatus.CANCELLED), Cheque.discount_amount)
        + _sum(cheque_q.filter(Cheque.status != DocumentStatus.CANCELLED), Cheque.interest_amount)
        + _sum(cheque_q.filter(Cheque.status != DocumentStatus.CANCELLED), Cheque.other_expenses)
    )
    boleto_gains = (
        _sum(boleto_q.filter(Boleto.status != DocumentStatus.CANCELLED), Boleto.discount_amount)
        + _sum(boleto_q.filter(Boleto.status != DocumentStatus.CANCELLED), Boleto.other_expenses)
    )
    gains_registered = cheque_gains + boleto_gains

    # Realised gains = informed costs of documents already settled (received).
    settled_gains = (
        _sum(cheque_q.filter(Cheque.status == DocumentStatus.SETTLED), Cheque.discount_amount)
        + _sum(cheque_q.filter(Cheque.status == DocumentStatus.SETTLED), Cheque.interest_amount)
        + _sum(cheque_q.filter(Cheque.status == DocumentStatus.SETTLED), Cheque.other_expenses)
        + _sum(boleto_q.filter(Boleto.status == DocumentStatus.SETTLED), Boleto.discount_amount)
        + _sum(boleto_q.filter(Boleto.status == DocumentStatus.SETTLED), Boleto.other_expenses)
    )

    receipts_total = _sum(receipt_q, Receipt.amount)
    receipts_count = receipt_q.count()
    operations_count = operation_q.count()

    open_total = _sum(cheque_q.filter(Cheque.status.in_(DocumentStatus.PENDING)), Cheque.net_amount) + _sum(
        boleto_q.filter(Boleto.status.in_(DocumentStatus.PENDING)), Boleto.net_amount
    )
    open_count = cheque_q.filter(Cheque.status.in_(DocumentStatus.PENDING)).count() + boleto_q.filter(
        Boleto.status.in_(DocumentStatus.PENDING)
    ).count()

    overdue_filter = (
        Cheque.status.in_(DocumentStatus.PENDING),
        Cheque.due_date < today,
    )
    overdue_total = _sum(cheque_q.filter(*overdue_filter), Cheque.net_amount) + _sum(
        boleto_q.filter(Boleto.status.in_(DocumentStatus.PENDING), Boleto.due_date < today), Boleto.net_amount
    )
    overdue_count = cheque_q.filter(*overdue_filter).count() + boleto_q.filter(
        Boleto.status.in_(DocumentStatus.PENDING), Boleto.due_date < today
    ).count()

    due_soon_filter = (
        Cheque.status.in_(DocumentStatus.PENDING),
        Cheque.due_date >= today,
        Cheque.due_date <= horizon,
    )
    due_soon_total = _sum(cheque_q.filter(*due_soon_filter), Cheque.net_amount) + _sum(
        boleto_q.filter(
            Boleto.status.in_(DocumentStatus.PENDING),
            Boleto.due_date >= today,
            Boleto.due_date <= horizon,
        ),
        Boleto.net_amount,
    )
    due_soon_count = cheque_q.filter(*due_soon_filter).count() + boleto_q.filter(
        Boleto.status.in_(DocumentStatus.PENDING),
        Boleto.due_date >= today,
        Boleto.due_date <= horizon,
    ).count()

    # Charts -----------------------------------------------------------------
    status_counts: dict[str, int] = {status: 0 for status in DocumentStatus.ALL}
    for model in (Cheque, Boleto):
        rows = scoped(model).with_entities(model.status, func.count(model.id)).group_by(model.status).all()
        for status, count in rows:
            status_counts[status] = status_counts.get(status, 0) + count

    by_type = [
        {
            "label": "Cheques",
            "count": cheque_q.count(),
            "nominal": float(cheques_nominal),
            "net": float(cheques_net),
        },
        {
            "label": "Boletos",
            "count": boleto_q.count(),
            "nominal": float(boletos_nominal),
            "net": float(boletos_net),
        },
    ]

    # Lists ------------------------------------------------------------------
    overdue_docs = []
    due_soon_docs = []
    for model in (Cheque, Boleto):
        overdue_docs.extend(
            scoped(model)
            .filter(model.status.in_(DocumentStatus.PENDING), model.due_date < today)
            .order_by(model.due_date.asc())
            .limit(10)
            .all()
        )
        due_soon_docs.extend(
            scoped(model)
            .filter(
                model.status.in_(DocumentStatus.PENDING),
                model.due_date >= today,
                model.due_date <= horizon,
            )
            .order_by(model.due_date.asc())
            .limit(10)
            .all()
        )

    overdue_docs.sort(key=lambda d: d.due_date or today)
    due_soon_docs.sort(key=lambda d: d.due_date or today)

    recent = []
    for model in (Cheque, Boleto):
        recent.extend(scoped(model).order_by(model.operation_date.desc(), model.id.desc()).limit(8).all())
    recent.sort(key=lambda d: (d.operation_date or today, d.id), reverse=True)

    recent_receipts = (
        receipt_q.order_by(Receipt.receipt_date.desc(), Receipt.id.desc()).limit(8).all()
    )

    # Monthly movement (derived sums of real records) -------------------------
    keys = _month_keys(today, date_from, date_to)
    monthly = {
        key: {"month": key, "label": f"{key[5:7]}/{key[:4]}", "documents": 0, "nominal": 0.0, "net": 0.0, "received": 0.0, "receipts": 0}
        for key in keys
    }
    for model, amount_column in ((Cheque, Cheque.nominal_amount), (Boleto, Boleto.original_amount)):
        rows = (
            scoped(model)
            .with_entities(model.operation_date, amount_column, model.net_amount)
            .all()
        )
        for operation_date, nominal, net in rows:
            key = operation_date.isoformat()[:7] if operation_date else None
            if key in monthly:
                monthly[key]["documents"] += 1
                monthly[key]["nominal"] += float(nominal or 0)
                monthly[key]["net"] += float(net or 0)
    for receipt_date, amount in receipt_q.with_entities(Receipt.receipt_date, Receipt.amount).all():
        key = receipt_date.isoformat()[:7] if receipt_date else None
        if key in monthly:
            monthly[key]["receipts"] += 1
            monthly[key]["received"] += float(amount or 0)
    by_month = [
        {
            **bucket,
            "nominal": round(bucket["nominal"], 2),
            "net": round(bucket["net"], 2),
            "received": round(bucket["received"], 2),
        }
        for bucket in monthly.values()
    ]

    def receipt_brief(receipt):
        document = receipt.resolve_document()
        return {
            "id": receipt.id,
            "code": receipt.code,
            "receipt_date": receipt.receipt_date.isoformat() if receipt.receipt_date else None,
            "amount": float(receipt.amount or 0),
            "document_kind": receipt.document_kind,
            "document_label": receipt.document_label,
            "document_id": receipt.document_id,
            "document_code": document.code if document else None,
            "client": (
                {"id": receipt.client.id, "name": receipt.client.name, "code": receipt.client.code}
                if receipt.client
                else None
            ),
        }

    def brief(doc):
        nominal = getattr(doc, "nominal_amount", None)
        if nominal is None:
            nominal = getattr(doc, "original_amount", 0)
        return {
            "id": doc.id,
            "kind": doc.__class__.__name__.upper(),
            "code": doc.code,
            "client": {"id": doc.client.id, "name": doc.client.name, "code": doc.client.code} if doc.client else None,
            "due_date": doc.due_date.isoformat() if doc.due_date else None,
            "nominal_amount": float(nominal or 0),
            "net_amount": float(doc.net_amount or 0),
            "status": doc.status,
            "status_label": doc.status_label,
            "is_overdue": doc.is_overdue,
        }

    return {
        "period": {
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
            "client_id": client_id,
        },
        "cards": {
            "clients_total": clients_total,
            "clients_active": clients_active,
            "operations_total": operations_total,
            "cheques_count": cheque_q.count(),
            "boletos_count": boleto_q.count(),
            "cheques_nominal": float(cheques_nominal),
            "boletos_nominal": float(boletos_nominal),
            "nominal_total": float(cheques_nominal + boletos_nominal),
            "paid_total": float(paid_total),
            "gains_registered": float(gains_registered),
            "gains_realized": float(settled_gains),
            "operations_count": operations_count,
            "receipts_count": receipts_count,
            "receipts_total": float(receipts_total),
            "open_total": float(open_total),
            "open_count": open_count,
            "overdue_total": float(overdue_total),
            "overdue_count": overdue_count,
            "due_soon_total": float(due_soon_total),
            "due_soon_count": due_soon_count,
        },
        "by_type": by_type,
        "by_status": [
            {
                "status": status,
                "label": DocumentStatus.LABELS[status],
                "count": status_counts.get(status, 0),
            }
            for status in DocumentStatus.ALL
        ],
        "overdue_documents": [brief(doc) for doc in overdue_docs[:10]],
        "due_soon_documents": [brief(doc) for doc in due_soon_docs[:10]],
        "recent_documents": [brief(doc) for doc in recent[:8]],
        "recent_receipts": [receipt_brief(receipt) for receipt in recent_receipts],
        "by_month": by_month,
        "top_clients": _top_clients(),
        "modules_pending": {},
    }
