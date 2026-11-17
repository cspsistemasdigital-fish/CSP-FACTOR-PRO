"""Attachment upload validation and storage."""
from __future__ import annotations

import uuid
from pathlib import Path

from werkzeug.utils import secure_filename

from .validators import ValidationError

SIGNATURES = {
    "pdf": (b"%PDF",),
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "webp": (b"RIFF",),
}

MAX_ATTACHMENT_NAME = 255


def _extension(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def validate_attachment(file_storage, allowed_extensions: set[str]) -> str:
    if file_storage is None or not file_storage.filename:
        raise ValidationError({"attachment": "Selecione um arquivo."})
    extension = _extension(file_storage.filename)
    if extension not in allowed_extensions:
        raise ValidationError(
            {"attachment": f"Formato não permitido. Use: {', '.join(sorted(allowed_extensions))}."}
        )
    head = file_storage.stream.read(512)
    file_storage.stream.seek(0)
    if extension == "webp":
        file_storage.stream.seek(8)
        container = file_storage.stream.read(4)
        file_storage.stream.seek(0)
        if head[:4] != b"RIFF" or container != b"WEBP":
            raise ValidationError({"attachment": "Arquivo WebP inválido."})
    else:
        if not any(head.startswith(sig) for sig in SIGNATURES[extension]):
            raise ValidationError({"attachment": "O conteúdo do arquivo não corresponde ao formato."})
    return extension


def save_attachment(file_storage, upload_folder: str, allowed_extensions: set[str]) -> dict:
    extension = validate_attachment(file_storage, allowed_extensions)
    stored_name = f"{uuid.uuid4().hex}.{extension}"
    destination = Path(upload_folder) / stored_name
    file_storage.save(destination)
    original = secure_filename(file_storage.filename) or f"anexo.{extension}"
    return {
        "path": stored_name,
        "name": original[:MAX_ATTACHMENT_NAME],
        "size": destination.stat().st_size,
    }


def delete_attachment(upload_folder: str, stored_name: str | None) -> None:
    """Best effort removal: never blocks the database operation.

    On Windows an attachment may be locked while it is being downloaded; the
    reference is removed anyway and the orphan file can be cleaned later.
    """
    if not stored_name:
        return
    candidate = (Path(upload_folder) / stored_name).resolve()
    folder = Path(upload_folder).resolve()
    if folder in candidate.parents and candidate.is_file():
        try:
            candidate.unlink(missing_ok=True)
        except OSError as exc:  # pragma: no cover - platform dependent
            import logging

            logging.getLogger(__name__).warning("Não foi possível remover o anexo %s: %s", candidate, exc)
