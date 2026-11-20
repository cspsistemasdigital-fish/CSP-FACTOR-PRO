"""Installment (parcela) of a loan.

Dates and amounts are generated as an editable suggestion and stored exactly as
confirmed by the user. No interest, fee or charge is ever calculated here.
"""
from __future__ import annotations

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso, money
from .document import DocumentStatus, is_overdue


class Installment(TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "installments"
    __table_args__ = (
        db.Index("ix_installments_loan_number", "loan_id", "number"),
        db.Index("ix_installments_loan_due", "loan_id", "due_date"),
    )

    id = db.Column(db.Integer, primary_key=True)
    loan_id = db.Column(db.Integer, db.ForeignKey("loans.id"), nullable=False, index=True)
    loan = db.relationship("Loan", back_populates="installments")

    number = db.Column(db.Integer, nullable=False)
    due_date = db.Column(db.Date, nullable=False, index=True)
    amount = db.Column(db.Numeric(15, 2), nullable=False)
    status = db.Column(
        db.String(15), nullable=False, default=DocumentStatus.OPEN, index=True
    )
    notes = db.Column(db.String(180), nullable=True)

    @property
    def is_pending(self) -> bool:
        return self.status in DocumentStatus.PENDING and not self.is_deleted

    @property
    def is_overdue(self) -> bool:
        return is_overdue(self.due_date, self.status)

    @property
    def status_label(self) -> str:
        return DocumentStatus.LABELS.get(self.status, self.status)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "loan_id": self.loan_id,
            "number": self.number,
            "due_date": iso(self.due_date),
            "amount": money(self.amount),
            "status": self.status,
            "status_label": self.status_label,
            "is_overdue": self.is_overdue,
            "notes": self.notes,
        }

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Installment loan={self.loan_id} n={self.number}>"
