"""Shared helpers for the cheque and boleto endpoints (attachments, history)."""
from __future__ import annotations

import os
from pathlib import Path

from flask import current_app, jsonify, request, send_file

from ..extensions import db
from ..models import AuditAction, AuditLog, DocumentAttachment
from ..services.audit import log_action
from ..utils.files import delete_attachment, save_attachment
from ..utils.responses import error
from ..utils.validators import ValidationError


def get_document_or_none(model, document_id: int):
    document = db.session.get(model, document_id)
    if not document or document.is_deleted:
        return None
    return document


def document_history(entity: str, document_id: int) -> list[dict]:
    entries = (
        AuditLog.query.filter_by(entity=entity, entity_id=document_id)
        .order_by(AuditLog.created_at.desc())
        .limit(40)
        .all()
    )
    return [entry.to_dict() for entry in entries]


def list_banks(model) -> list[str]:
    rows = (
        db.session.query(model.bank)
        .filter(model.is_deleted.is_(False), model.bank.isnot(None))
        .distinct()
        .order_by(model.bank.asc())
        .all()
    )
    return [row[0] for row in rows if row[0]]


def upload_attachment(document, entity: str, user):
    file_storage = request.files.get("file")
    allowed = current_app.config["ALLOWED_UPLOAD_EXTENSIONS"]
    try:
        info = save_attachment(file_storage, current_app.config["UPLOAD_FOLDER"], allowed)
    except ValidationError:
        raise
    old_file = document.attachment_path
    document.attachment_path = info["path"]
    document.attachment_name = info["name"]
    document.attachment_size = info["size"]
    document.updated_by_id = getattr(user, "id", None)
    delete_attachment(current_app.config["UPLOAD_FOLDER"], old_file)
    log_action(
        AuditAction.UPDATE,
        entity,
        document.id,
        f"Anexo enviado para {document.code}",
        changes={"attachment": [None, info["name"]]},
    )
    db.session.commit()
    return jsonify(
        {
            "item": document.to_dict(),
            "message": "Anexo enviado com sucesso.",
        }
    )


def download_attachment(document):
    if not document.attachment_path:
        return error("Este documento não possui anexo.", 404)
    folder = Path(current_app.config["UPLOAD_FOLDER"]).resolve()
    candidate = (folder / document.attachment_path).resolve()
    if folder not in candidate.parents or not candidate.is_file():
        return error("Arquivo do anexo não encontrado. Envie novamente.", 404)
    path = str(candidate)
    download_name = document.attachment_name or document.attachment_path
    return send_file(
        path,
        as_attachment=False,
        download_name=f"{document.code}-{download_name}",
        max_age=0,
    )


def remove_attachment(document, entity: str, user):
    if not document.attachment_path:
        return error("Este documento não possui anexo.", 404)
    old_name = document.attachment_name
    delete_attachment(current_app.config["UPLOAD_FOLDER"], document.attachment_path)
    document.attachment_path = None
    document.attachment_name = None
    document.attachment_size = None
    document.updated_by_id = getattr(user, "id", None)
    log_action(
        AuditAction.UPDATE,
        entity,
        document.id,
        f"Anexo removido de {document.code}",
        changes={"attachment": [old_name, None]},
    )
    db.session.commit()
    return jsonify({"item": document.to_dict(), "message": "Anexo removido."})


# --- Multiple photos captured on a phone/tablet (Etapa 8) -------------------

PHOTO_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}


def list_photos(document, document_kind: str):
    """Return every extra photo plus the legacy single attachment, if any."""
    rows = (
        DocumentAttachment.query.filter_by(
            document_kind=document_kind, document_id=document.id, is_deleted=False
        )
        .order_by(DocumentAttachment.created_at.asc(), DocumentAttachment.id.asc())
        .all()
    )
    items = [row.to_dict() for row in rows]
    if document.attachment_path:
        items.insert(
            0,
            {
                "id": None,
                "name": document.attachment_name or document.attachment_path,
                "size": document.attachment_size,
                "content_type": None,
                "legacy": True,
                "created_at": None,
            },
        )
    return jsonify({"items": items})


def upload_photos(document, document_kind: str, entity: str, user):
    """Save each submitted photo as an independent attachment row."""
    files = [item for item in request.files.getlist("files") if item and item.filename]
    if not files:
        single = request.files.get("file")
        if single and single.filename:
            files = [single]
    if not files:
        raise ValidationError({"files": "Selecione ou capture ao menos uma foto."})

    allowed = PHOTO_EXTENSIONS.intersection(current_app.config["ALLOWED_UPLOAD_EXTENSIONS"])
    created = []
    for storage in files:
        info = save_attachment(storage, current_app.config["UPLOAD_FOLDER"], allowed)
        created.append(
            DocumentAttachment(
                document_kind=document_kind,
                document_id=document.id,
                path=info["path"],
                name=info["name"],
                size=info["size"],
                content_type=storage.mimetype or None,
                created_by_id=getattr(user, "id", None),
            )
        )
    db.session.add_all(created)
    log_action(
        AuditAction.UPDATE,
        entity,
        document.id,
        f"{len(created)} foto(s) enviada(s) para {document.code}",
        changes={"photos": [None, [row.name for row in created]]},
    )
    db.session.commit()
    return jsonify(
        {
            "items": [row.to_dict() for row in created],
            "message": f"{len(created)} foto(s) enviada(s) com sucesso.",
        }
    )


def get_photo_or_none(document, document_kind: str, attachment_id: int):
    row = db.session.get(DocumentAttachment, attachment_id)
    if (
        not row
        or row.is_deleted
        or row.document_kind != document_kind
        or row.document_id != document.id
    ):
        return None
    return row


def download_photo(document, row):
    path = os.path.join(current_app.config["UPLOAD_FOLDER"], row.path)
    if not os.path.isfile(path):
        return error("Arquivo da foto não encontrado. Envie novamente.", 404)
    return send_file(
        path,
        as_attachment=False,
        download_name=f"{document.code}-{row.name}",
        max_age=0,
    )


def remove_photo(document, row, entity: str, user):
    delete_attachment(current_app.config["UPLOAD_FOLDER"], row.path)
    old_name = row.name
    row.soft_delete(getattr(user, "id", None))
    log_action(
        AuditAction.DELETE,
        entity,
        document.id,
        f"Foto removida de {document.code}",
        changes={"photo": [old_name, None]},
    )
    db.session.commit()
    return jsonify({"message": "Foto removida."})
