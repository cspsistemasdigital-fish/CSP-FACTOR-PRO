"""Receipt (recebimento) model - manual settlement of a cheque or boleto.

Nothing is settled automatically: each receipt is an explicit user action with
a date and an amount informed by the operator. The system never calculates
interest, discount or fees - it only compares the informed amount with the
document's net value to show the remaining balance.
"""
from __future__ import annotations

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso, money
from .document import DocumentKind


class Receipt(TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "receipts"
    __table_args__ = (
        db.Index("ix_receipts_document", "document_kind", "document_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), nullable=False, unique=True, index=True)

    document_kind = db.Column(db.String(10), nullable=False, index=True)  # CHEQUE | BOLETO
    document_id = db.Column(db.Integer, nullable=False, index=True)

    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False, index=True)
    client = db.relationship("Client", back_populates="receipts")

    receipt_date = db.Column(db.Date, nullable=False, index=True)
    amount = db.Column(db.Numeric(15, 2), nullable=False)
    notes = db.Column(db.Text, nullable=True)

    attachment_path = db.Column(db.String(255), nullable=True)
    attachment_name = db.Column(db.String(255), nullable=True)
    attachment_size = db.Column(db.Integer, nullable=True)

    # --- Derived values -----------------------------------------------------
    @property
    def document_label(self) -> str:
        return DocumentKind.LABELS.get(self.document_kind, self.document_kind)

    def resolve_document(self):
        """Return the linked cheque/boleto (even if soft-deleted) or ``None``."""
        from .boleto import Boleto
        from .cheque import Cheque

        model = Cheque if self.document_kind == DocumentKind.CHEQUE else Boleto
        return db.session.get(model, self.document_id)

    def to_dict(self, include_notes: bool = True) -> dict:
        document = self.resolve_document()
        return {
            "id": self.id,
            "code": self.code,
            "document_kind": self.document_kind,
            "document_label": self.document_label,
            "document_id": self.document_id,
            "document": (
                {
                    "id": document.id,
                    "kind": self.document_kind,
                    "code": document.code,
                    "due_date": iso(document.due_date),
                    "net_amount": money(document.net_amount),
                    "status": document.status,
                    "status_label": document.status_label,
                }
                if document
                else None
            ),
            "client_id": self.client_id,
            "client": (
                {"id": self.client.id, "code": self.client.code, "name": self.client.name}
                if self.client
                else None
            ),
            "receipt_date": iso(self.receipt_date),
            "amount": money(self.amount),
            "has_attachment": bool(self.attachment_path),
            "attachment_name": self.attachment_name,
            "notes": self.notes if include_notes else None,
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
            "created_by": self.created_by.name if self.created_by else None,
            "updated_by": self.updated_by.name if self.updated_by else None,
        }

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Receipt {self.code} {self.document_kind}#{self.document_id}>"
