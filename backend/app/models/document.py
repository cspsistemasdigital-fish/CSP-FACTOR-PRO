"""Shared document status definitions and attachments helper."""
from __future__ import annotations

from datetime import date


class DocumentKind:
    """Discriminator used when a record references a cheque or a boleto."""

    CHEQUE = "CHEQUE"
    BOLETO = "BOLETO"

    ALL = (CHEQUE, BOLETO)
    LABELS = {CHEQUE: "Cheque", BOLETO: "Boleto"}


# Escopo do relatório geral: títulos de crédito mais empréstimos. Não é um
# DocumentKind (que discrimina anexos/recebimentos) — apenas um filtro de tela.
REPORT_KINDS = DocumentKind.ALL + ("EMPRESTIMO",)
REPORT_KIND_LABELS = {**DocumentKind.LABELS, "EMPRESTIMO": "Empréstimo"}


class DocumentStatus:
    OPEN = "EM_ABERTO"
    SETTLED = "LIQUIDADO"
    RETURNED = "DEVOLVIDO"
    CANCELLED = "CANCELADO"

    ALL = (OPEN, SETTLED, RETURNED, CANCELLED)
    LABELS = {
        OPEN: "Em aberto",
        SETTLED: "Liquidado",
        RETURNED: "Devolvido",
        CANCELLED: "Cancelado",
    }
    # Statuses that still represent money owed by the client.
    PENDING = (OPEN, RETURNED)


def is_overdue(due_date: date | None, status: str) -> bool:
    if not due_date:
        return False
    return status in DocumentStatus.PENDING and due_date < date.today()
