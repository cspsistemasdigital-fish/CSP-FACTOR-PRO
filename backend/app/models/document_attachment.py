"""Additional photos attached to cheques, boletos and receipts (Etapa 8).

The original document tables keep one legacy attachment each for backwards
compatibility; every new photo is stored here so users can capture several
images in sequence and upload them all without replacing the previous one.
"""
from __future__ import annotations

from ..extensions import db
from .base import SoftDeleteMixin, TimestampMixin, iso


class DocumentAttachment(TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "document_attachments"

    id = db.Column(db.Integer, primary_key=True)
    document_kind = db.Column(db.String(20), nullable=False, index=True)
    document_id = db.Column(db.Integer, nullable=False, index=True)
    path = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    size = db.Column(db.Integer, nullable=False, default=0)
    content_type = db.Column(db.String(120), nullable=True)

    __table_args__ = (
        db.Index("ix_document_attachment_document", "document_kind", "document_id"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "size": self.size,
            "content_type": self.content_type,
            "created_at": iso(self.created_at),
        }
