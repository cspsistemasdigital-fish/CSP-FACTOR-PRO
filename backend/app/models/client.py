"""Client (customer) model."""
from __future__ import annotations

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso, money


class ClientStatus:
    ACTIVE = "ATIVO"
    INACTIVE = "INATIVO"
    ALL = (ACTIVE, INACTIVE)
    LABELS = {ACTIVE: "Ativo", INACTIVE: "Inativo"}


class Client(TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "clients"
    __table_args__ = (
        db.Index(
            "uq_clients_document_active",
            "document",
            unique=True,
            sqlite_where=db.text("is_deleted = 0"),
            postgresql_where=db.text("is_deleted = false"),
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), nullable=False, unique=True, index=True)
    name = db.Column(db.String(180), nullable=False, index=True)
    person_type = db.Column(db.String(2), nullable=False, default="PF")  # PF | PJ
    document = db.Column(db.String(14), nullable=False, index=True)     # digits only
    phone = db.Column(db.String(20), nullable=True)
    whatsapp = db.Column(db.String(20), nullable=True)
    email = db.Column(db.String(160), nullable=True)
    address = db.Column(db.String(220), nullable=True)
    city = db.Column(db.String(120), nullable=True)
    state = db.Column(db.String(2), nullable=True)
    zip_code = db.Column(db.String(8), nullable=True)
    registered_at = db.Column(db.Date, nullable=False)
    operational_limit = db.Column(db.Numeric(15, 2), nullable=False, default=0)
    notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(10), nullable=False, default=ClientStatus.ACTIVE, index=True)
    # Explicit, audited block for delinquent clients. Derived overdue data is an
    # alert only; the block is always a human decision (never automatic).
    is_blocked = db.Column(db.Boolean, nullable=False, default=False, index=True)
    blocked_reason = db.Column(db.String(255), nullable=True)
    blocked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    blocked_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    blocked_by = db.relationship("User", foreign_keys=[blocked_by_id])

    cheques = db.relationship("Cheque", back_populates="client", lazy="dynamic")
    boletos = db.relationship("Boleto", back_populates="client", lazy="dynamic")
    operations = db.relationship("Operation", back_populates="client", lazy="dynamic")
    receipts = db.relationship("Receipt", back_populates="client", lazy="dynamic")
    loans = db.relationship("Loan", back_populates="client", lazy="dynamic")

    @property
    def status_label(self) -> str:
        return ClientStatus.LABELS.get(self.status, self.status)

    @property
    def is_active(self) -> bool:
        return self.status == ClientStatus.ACTIVE and not self.is_deleted

    def to_dict(self, include_relations: bool = False) -> dict:
        data = {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "person_type": self.person_type,
            "document": self.document,
            "phone": self.phone,
            "whatsapp": self.whatsapp,
            "email": self.email,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "zip_code": self.zip_code,
            "registered_at": iso(self.registered_at),
            "operational_limit": money(self.operational_limit),
            "notes": self.notes,
            "status": self.status,
            "status_label": self.status_label,
            "is_blocked": bool(self.is_blocked),
            "blocked_reason": self.blocked_reason,
            "blocked_at": iso(self.blocked_at),
            "blocked_by": self.blocked_by.name if self.blocked_by else None,
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
            "created_by": self.created_by.name if self.created_by else None,
            "updated_by": self.updated_by.name if self.updated_by else None,
        }
        if include_relations:
            data["documents"] = [d.to_dict() for d in self.open_documents()]
        return data

    def open_documents(self):
        from .boleto import Boleto
        from .cheque import Cheque
        from .document import DocumentStatus

        cheques = (
            Cheque.query.filter_by(client_id=self.id, is_deleted=False)
            .filter(Cheque.status.in_([DocumentStatus.OPEN, DocumentStatus.RETURNED]))
            .order_by(Cheque.due_date.asc())
            .all()
        )
        boletos = (
            Boleto.query.filter_by(client_id=self.id, is_deleted=False)
            .filter(Boleto.status.in_([DocumentStatus.OPEN, DocumentStatus.RETURNED]))
            .order_by(Boleto.due_date.asc())
            .all()
        )
        return sorted(cheques + boletos, key=lambda d: (d.due_date or d.operation_date))

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Client {self.code} {self.name}>"
