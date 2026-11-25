"""Operation (borderô) model - a batch of documents purchased from one client.

The system NEVER calculates interest, discount or fees. Every monetary value
belongs to the documents themselves; the operation totals are always DERIVED
from the linked cheques and boletos (never stored, never invented).
"""
from __future__ import annotations

from decimal import Decimal

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso, money


class OperationStatus:
    OPEN = "ABERTA"
    CLOSED = "FECHADA"

    ALL = (OPEN, CLOSED)
    LABELS = {OPEN: "Aberta", CLOSED: "Fechada"}


def document_nominal(document) -> Decimal:
    """Cheques expose ``nominal_amount``; boletos expose ``original_amount``."""
    value = getattr(document, "nominal_amount", None)
    if value is None:
        value = getattr(document, "original_amount", 0)
    return Decimal(value or 0)


def document_costs(document) -> Decimal:
    """Informed costs (never automatically calculated by the system)."""
    total = Decimal(document.discount_amount or 0) + Decimal(document.other_expenses or 0)
    total += Decimal(getattr(document, "interest_amount", 0) or 0)
    return total


class Operation(TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "operations"
    __table_args__ = (
        db.Index("ix_operations_client_date", "client_id", "operation_date"),
    )

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), nullable=False, unique=True, index=True)

    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False, index=True)
    client = db.relationship("Client", back_populates="operations")

    operation_date = db.Column(db.Date, nullable=False, index=True)
    description = db.Column(db.String(180), nullable=True)
    status = db.Column(db.String(15), nullable=False, default=OperationStatus.OPEN, index=True)
    notes = db.Column(db.Text, nullable=True)

    cheques = db.relationship("Cheque", back_populates="operation", lazy="selectin")
    boletos = db.relationship("Boleto", back_populates="operation", lazy="selectin")
    loans = db.relationship("Loan", back_populates="operation", lazy="selectin")

    # --- Derived values -----------------------------------------------------
    def active_documents(self) -> list:
        """Documents still visible (soft-deleted ones never count)."""
        return [d for d in (*self.cheques, *self.boletos) if not d.is_deleted]

    def active_loans(self) -> list:
        return [loan for loan in self.loans if not loan.is_deleted]

    def totals(self) -> dict:
        nominal = Decimal("0.00")
        costs = Decimal("0.00")
        net = Decimal("0.00")
        applied_limit = Decimal("0.00")
        for document in self.active_documents():
            nominal += document_nominal(document)
            costs += document_costs(document)
            net += Decimal(document.net_amount or 0)
            applied_limit += Decimal(document.applied_limit or 0)
        loans = self.active_loans()
        return {
            "documents": len(self.active_documents()),
            "nominal": money(nominal),
            "costs": money(costs),
            "net": money(net),
            "applied_limit": money(applied_limit),
            "loans": len(loans),
            "loan_amount": money(sum((Decimal(loan.loan_amount or 0) for loan in loans), Decimal("0.00"))),
            "loan_received_amount": money(sum((Decimal(loan.received_amount or 0) for loan in loans), Decimal("0.00"))),
            "loan_profit_amount": money(sum((Decimal(loan.profit_amount or 0) for loan in loans), Decimal("0.00"))),
        }

    @property
    def status_label(self) -> str:
        return OperationStatus.LABELS.get(self.status, self.status)

    def to_dict(self, include_items: bool = True) -> dict:
        documents = self.active_documents()
        data = {
            "id": self.id,
            "code": self.code,
            "client_id": self.client_id,
            "client": (
                {"id": self.client.id, "code": self.client.code, "name": self.client.name}
                if self.client
                else None
            ),
            "operation_date": iso(self.operation_date),
            "description": self.description,
            "status": self.status,
            "status_label": self.status_label,
            "notes": self.notes,
            "documents_count": len(documents),
            "loans_count": len(self.active_loans()),
            "totals": self.totals(),
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
            "created_by": self.created_by.name if self.created_by else None,
            "updated_by": self.updated_by.name if self.updated_by else None,
        }
        if include_items:
            data["items"] = [document.to_dict() for document in sorted(
                documents, key=lambda d: (d.due_date or d.operation_date, d.id)
            )]
            data["loans"] = [
                loan.to_dict(include_items=False)
                for loan in sorted(self.active_loans(), key=lambda value: (value.loan_date, value.id))
            ]
        return data

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Operation {self.code} client={self.client_id}>"
