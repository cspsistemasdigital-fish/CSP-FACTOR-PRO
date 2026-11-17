"""Cheque model - values are always informed manually by the user."""
from __future__ import annotations

from decimal import Decimal

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso, money
from .document import DocumentStatus, is_overdue


class Cheque(TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "cheques"
    __table_args__ = (
        db.Index("ix_cheques_due_status", "due_date", "status"),
        db.Index("ix_cheques_operation_date", "operation_date"),
    )

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), nullable=False, unique=True, index=True)
    number = db.Column(db.String(30), nullable=False)
    bank = db.Column(db.String(80), nullable=False, index=True)
    agency = db.Column(db.String(20), nullable=True)
    account = db.Column(db.String(30), nullable=True)
    identifier = db.Column(db.String(60), nullable=True, index=True)

    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False, index=True)
    client = db.relationship("Client", back_populates="cheques")

    operation_id = db.Column(db.Integer, db.ForeignKey("operations.id"), nullable=True, index=True)
    operation = db.relationship("Operation", back_populates="cheques")

    issuer_document = db.Column(db.String(14), nullable=False)
    issuer_name = db.Column(db.String(180), nullable=False)

    nominal_amount = db.Column(db.Numeric(15, 2), nullable=False)
    issue_date = db.Column(db.Date, nullable=True)
    due_date = db.Column(db.Date, nullable=False)
    operation_date = db.Column(db.Date, nullable=False)

    discount_amount = db.Column(db.Numeric(15, 2), nullable=False, default=0)
    interest_amount = db.Column(db.Numeric(15, 2), nullable=False, default=0)
    other_expenses = db.Column(db.Numeric(15, 2), nullable=False, default=0)
    net_amount = db.Column(db.Numeric(15, 2), nullable=False)
    applied_limit = db.Column(db.Numeric(15, 2), nullable=True)

    status = db.Column(db.String(15), nullable=False, default=DocumentStatus.OPEN, index=True)
    notes = db.Column(db.Text, nullable=True)

    attachment_path = db.Column(db.String(255), nullable=True)
    attachment_name = db.Column(db.String(255), nullable=True)
    attachment_size = db.Column(db.Integer, nullable=True)

    # --- Derived values (never used to replace user informed values) -------
    @property
    def divergence_amount(self) -> Decimal:
        informed_costs = (
            Decimal(self.discount_amount or 0)
            + Decimal(self.interest_amount or 0)
            + Decimal(self.other_expenses or 0)
        )
        expected_net = Decimal(self.nominal_amount or 0) - informed_costs
        return (expected_net - Decimal(self.net_amount or 0)).quantize(Decimal("0.01"))

    @property
    def has_divergence(self) -> bool:
        return abs(self.divergence_amount) > Decimal("0.01")

    @property
    def is_overdue(self) -> bool:
        return is_overdue(self.due_date, self.status)

    @property
    def status_label(self) -> str:
        return DocumentStatus.LABELS.get(self.status, self.status)

    def to_dict(self, include_notes: bool = True) -> dict:
        return {
            "id": self.id,
            "kind": "CHEQUE",
            "code": self.code,
            "number": self.number,
            "bank": self.bank,
            "agency": self.agency,
            "account": self.account,
            "identifier": self.identifier,
            "client_id": self.client_id,
            "client": (
                {"id": self.client.id, "code": self.client.code, "name": self.client.name}
                if self.client
                else None
            ),
            "operation_id": self.operation_id,
            "operation": (
                {"id": self.operation.id, "code": self.operation.code}
                if self.operation
                else None
            ),
            "issuer_document": self.issuer_document,
            "issuer_name": self.issuer_name,
            "nominal_amount": money(self.nominal_amount),
            "issue_date": iso(self.issue_date),
            "due_date": iso(self.due_date),
            "operation_date": iso(self.operation_date),
            "discount_amount": money(self.discount_amount),
            "interest_amount": money(self.interest_amount),
            "other_expenses": money(self.other_expenses),
            "net_amount": money(self.net_amount),
            "applied_limit": money(self.applied_limit),
            "divergence_amount": money(self.divergence_amount),
            "has_divergence": self.has_divergence,
            "status": self.status,
            "status_label": self.status_label,
            "is_overdue": self.is_overdue,
            "has_attachment": bool(self.attachment_path),
            "attachment_name": self.attachment_name,
            "notes": self.notes if include_notes else None,
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
            "created_by": self.created_by.name if self.created_by else None,
            "updated_by": self.updated_by.name if self.updated_by else None,
        }

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Cheque {self.code} R$ {self.nominal_amount}>"
