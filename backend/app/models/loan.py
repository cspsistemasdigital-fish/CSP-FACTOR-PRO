"""Loan (empréstimo) model.

Regra soberana: o sistema NUNCA calcula juros, descontos, taxas ou encargos.
Os três valores monetários (empréstimo, valor recebido pelo cliente e lucro de
quem empresta) são INFORMADOS pelo usuário e gravados exatamente como digitados.
As parcelas são uma distribuição sugerida do principal informado, sempre
editável, e existem apenas para organizar vencimentos.
"""
from __future__ import annotations

from decimal import Decimal

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso, money
from .document import is_overdue


class LoanStatus:
    OPEN = "ABERTA"
    SETTLED = "QUITADA"
    CANCELLED = "CANCELADA"

    ALL = (OPEN, SETTLED, CANCELLED)
    LABELS = {OPEN: "Aberta", SETTLED: "Quitada", CANCELLED: "Cancelada"}


class Loan(TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "loans"
    __table_args__ = (
        db.Index("ix_loans_client_date", "client_id", "loan_date"),
    )

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), nullable=False, unique=True, index=True)

    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False, index=True)
    client = db.relationship("Client", back_populates="loans")

    loan_date = db.Column(db.Date, nullable=False, index=True)
    loan_amount = db.Column(db.Numeric(15, 2), nullable=False)
    received_amount = db.Column(db.Numeric(15, 2), nullable=False)
    profit_amount = db.Column(db.Numeric(15, 2), nullable=False, default=0)
    status = db.Column(db.String(12), nullable=False, default=LoanStatus.OPEN, index=True)
    notes = db.Column(db.Text, nullable=True)

    installments = db.relationship("Installment", back_populates="loan", lazy="selectin")

    # --- Derived values (comparisons only, never stored) --------------------
    def active_installments(self) -> list:
        return [item for item in self.installments if not item.is_deleted]

    @property
    def divergence(self) -> Decimal:
        """Comparação informativa: (empréstimo − lucro) − valor recebido."""
        return (
            Decimal(self.loan_amount or 0)
            - Decimal(self.profit_amount or 0)
            - Decimal(self.received_amount or 0)
        )

    @property
    def has_divergence(self) -> bool:
        return abs(self.divergence) > Decimal("0.01")

    def totals(self) -> dict:
        items = self.active_installments()
        scheduled = sum((Decimal(item.amount or 0) for item in items), Decimal("0.00"))
        open_amount = sum(
            (Decimal(item.amount or 0) for item in items if item.is_pending), Decimal("0.00")
        )
        return {
            "installments": len(items),
            "scheduled": money(scheduled),
            "open_amount": money(open_amount),
            "overdue_installments": sum(1 for item in items if item.is_overdue),
        }

    @property
    def status_label(self) -> str:
        return LoanStatus.LABELS.get(self.status, self.status)

    def to_dict(self, include_items: bool = True) -> dict:
        client_data = None
        if self.client:
            client_data = {
                "id": self.client.id,
                "code": self.client.code,
                "name": self.client.name,
                "document": self.client.document,
                "person_type": self.client.person_type,
                "phone": self.client.phone,
                "whatsapp": self.client.whatsapp,
                "email": self.client.email,
                "address": self.client.address,
                "city": self.client.city,
                "state": self.client.state,
                "zip_code": self.client.zip_code,
                "operational_limit": money(self.client.operational_limit),
            }
        data = {
            "id": self.id,
            "code": self.code,
            "client_id": self.client_id,
            "client": client_data,
            "loan_date": iso(self.loan_date),
            "loan_amount": money(self.loan_amount),
            "received_amount": money(self.received_amount),
            "profit_amount": money(self.profit_amount),
            "status": self.status,
            "status_label": self.status_label,
            "notes": self.notes,
            "divergence": money(self.divergence),
            "has_divergence": self.has_divergence,
            "totals": self.totals(),
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
            "created_by": self.created_by.name if self.created_by else None,
            "updated_by": self.updated_by.name if self.updated_by else None,
        }
        if include_items:
            data["installments"] = [
                item.to_dict()
                for item in sorted(
                    self.active_installments(),
                    key=lambda value: (value.due_date or self.loan_date, value.number),
                )
            ]
        return data

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Loan {self.code} client={self.client_id}>"
