"""Global alerts shown whenever the application is opened.

Only *comparisons* are derived here (due date < today). No interest, discount
or charge is calculated: amounts come straight from the informed net values.
"""
from __future__ import annotations

from decimal import Decimal

from ..models.base import iso, utcnow
from .clients import exposure_map, overdue_client_ids


def build_alerts() -> dict:
    ids = overdue_client_ids()
    items: list[dict] = []
    total = Decimal("0.00")
    document_count = 0

    if ids:
        from ..models import Client

        clients = Client.query.filter(Client.id.in_(ids)).order_by(Client.name.asc()).all()
        exposure = exposure_map(ids)
        for client in clients:
            data = exposure.get(client.id) or {}
            amount = Decimal(data.get("overdue_amount") or 0)
            count = int(data.get("overdue_documents") or 0)
            count_label = "item vencido" if count == 1 else "itens vencidos"
            total += amount
            document_count += count
            reason = (
                f"Motivo do bloqueio: {client.blocked_reason}."
                if client.is_blocked and client.blocked_reason
                else ""
            )
            items.append(
                {
                    "client_id": client.id,
                    "code": client.code,
                    "name": client.name,
                    "document": client.document,
                    "phone": client.phone,
                    "whatsapp": client.whatsapp,
                    "overdue_amount": float(amount.quantize(Decimal("0.01"))),
                    "overdue_documents": count,
                    "overdue_count": count,
                    "is_blocked": bool(client.is_blocked),
                    "blocked_reason": client.blocked_reason,
                    "message": (
                        f"{client.name} ({client.code}) possui {count} {count_label} "
                        f"totalizando {amount.quantize(Decimal('0.01')):,.2f} em atraso. {reason}".strip()
                    ),
                }
            )

    if items:
        overdue_label = "item vencido" if document_count == 1 else "itens vencidos"
        headline = (
            f"{len(items)} cliente(s) com itens vencidos: {document_count} {overdue_label}."
        )
    else:
        headline = "Nenhum item vencido no momento."

    return {
        "items": items,
        "client_count": len(items),
        "document_count": document_count,
        "overdue_count": document_count,
        "total_amount": float(total.quantize(Decimal("0.01"))),
        "message": headline,
        "generated_at": iso(utcnow()),
    }
