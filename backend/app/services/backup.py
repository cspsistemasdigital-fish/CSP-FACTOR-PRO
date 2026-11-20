"""Daily safety backups of the database and uploaded files.

Backups are stored as ZIP files inside BACKUP_FOLDER (under instance/ by
default, therefore never versioned). The database snapshot is taken with
sqlite3's online backup API for SQLite, or pg_dump for PostgreSQL. Uploaded
attachments are included by default so a restore does not lose documents.

Nothing here calculates business values: this is a copy of stored data only.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import subprocess
import threading
import zipfile
from datetime import datetime
from pathlib import Path

from flask import current_app
from sqlalchemy.engine import make_url

from ..extensions import db
from ..models import Setting

logger = logging.getLogger(__name__)
_BACKUP_LOCK = threading.Lock()
_BACKUP_NAME_RE = re.compile(r"^backup-\d{8}-\d{6}\.zip$")

BACKUP_KEYS = (
    "backup_enabled",
    "backup_time",
    "backup_retention_days",
    "backup_include_uploads",
    "backup_last_at",
    "backup_last_error",
)

BACKUP_DEFAULTS = {
    "backup_enabled": "true",
    "backup_time": "03:00",
    "backup_retention_days": "7",
    "backup_include_uploads": "true",
    "backup_last_at": "",
    "backup_last_error": "",
}


def get_backup_config() -> dict:
    """Read backup preferences straight from the settings table."""
    stored = {row.key: row.value for row in Setting.query.filter(Setting.key.in_(BACKUP_KEYS)).all()}
    return {**BACKUP_DEFAULTS, **stored}


def _write_setting(key: str, value) -> None:
    """Internal writer used by the scheduler (no request/current user)."""
    row = db.session.get(Setting, key)
    if not row:
        row = Setting(key=key)
        db.session.add(row)
    row.value = str(value or "")
    db.session.commit()


def backup_folder() -> Path:
    folder = Path(current_app.config["BACKUP_FOLDER"])
    if not folder.is_absolute():
        folder = (Path(current_app.root_path).parent / folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _write_database_snapshot(destination: Path) -> str:
    """Dump the database to *destination* and return the archive entry name."""
    uri = current_app.config["SQLALCHEMY_DATABASE_URI"]
    if uri in {"sqlite://", "sqlite:///:memory:"}:
        # In-memory databases (tests) cannot be copied from disk: dump via DBAPI.
        connection = db.engine.raw_connection()
        try:
            raw = getattr(connection, "driver_connection", None)
            if raw is None:  # pragma: no cover - SQLAlchemy < 2.0
                raw = connection.connection
            destination.write_text("\n".join(raw.iterdump()), encoding="utf-8")
        finally:
            connection.close()
        return "database.sql"

    if uri.startswith("sqlite:///"):
        source = Path(uri.replace("sqlite:///", "", 1))
        if not source.is_file():
            raise RuntimeError("Banco de dados SQLite não encontrado para o backup.")
        target = sqlite3.connect(destination)
        try:
            origin = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
            try:
                origin.backup(target)
            finally:
                origin.close()
        finally:
            target.close()
        return "database.sqlite"

    # PostgreSQL: pg_dump produces a portable SQL script.
    url = make_url(uri)
    env = os.environ.copy()
    if url.password:
        env["PGPASSWORD"] = str(url.password)
    command = [
        current_app.config.get("BACKUP_PG_DUMP_PATH", "pg_dump"),
        "--no-owner",
        "--no-privileges",
        "--host", url.host or "localhost",
        "--port", str(url.port or 5432),
        "--username", url.username or "",
        "--dbname", url.database or "",
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        env=env,
        timeout=current_app.config.get("BACKUP_PG_DUMP_TIMEOUT_SECONDS", 120),
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", "replace").strip()[:300]
        raise RuntimeError(f"pg_dump falhou: {detail or 'erro desconhecido'}")
    destination.write_bytes(completed.stdout)
    return "database.sql"


def create_backup(include_uploads: bool | None = None) -> dict:
    """Create a timestamped ZIP backup and return its metadata."""
    config = get_backup_config()
    if include_uploads is None:
        include_uploads = config.get("backup_include_uploads", "true") in {"1", "true", "yes", "on"}

    folder = backup_folder()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"backup-{stamp}.zip"
    target = folder / name
    temporary = folder / f".{name}.tmp"

    try:
        snapshot = folder / f".database-{stamp}.tmp"
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
            entry = _write_database_snapshot(snapshot)
            archive.write(snapshot, entry)
            snapshot.unlink(missing_ok=True)

            if include_uploads:
                uploads = Path(current_app.config["UPLOAD_FOLDER"])
                if uploads.is_dir():
                    for item in sorted(uploads.rglob("*")):
                        if item.is_file():
                            archive.write(item, f"uploads/{item.relative_to(uploads).as_posix()}")

            archive.writestr(
                "manifest.json",
                __import__("json").dumps(
                    {
                        "created_at": datetime.now().isoformat(timespec="seconds"),
                        "application": current_app.config.get("APP_NAME", "FACTOR PRO"),
                        "database": entry,
                        "uploads": include_uploads,
                        "version": current_app.config.get("APP_VERSION", "1.0.0"),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)

    prune_backups()
    logger.info("Backup criado: %s", name)
    return {"name": name, "size": target.stat().st_size, "created_at": datetime.now().isoformat(timespec="seconds")}


def list_backups() -> list[dict]:
    """Metadata for every stored backup, newest first."""
    folder = backup_folder()
    items = []
    for path in sorted(folder.glob("backup-*.zip"), reverse=True):
        if not _BACKUP_NAME_RE.match(path.name) or not path.is_file():
            continue
        stat = path.stat()
        items.append(
            {
                "name": path.name,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            }
        )
    return items


def delete_backup(name: str) -> bool:
    """Remove one stored backup. Invalid names never touch the filesystem."""
    if not _BACKUP_NAME_RE.match(name or ""):
        return False
    folder = backup_folder()
    candidate = (folder / name).resolve()
    if candidate.parent != folder.resolve() or not candidate.is_file():
        return False
    candidate.unlink()
    return True


def prune_backups() -> int:
    """Delete backups older than the configured retention window."""
    config = get_backup_config()
    try:
        days = max(1, min(365, int(config.get("backup_retention_days", "7"))))
    except (TypeError, ValueError):
        days = 7
    limit = datetime.now().timestamp() - days * 24 * 60 * 60
    removed = 0
    for item in list_backups():
        path = backup_folder() / item["name"]
        if path.stat().st_mtime < limit and delete_backup(item["name"]):
            removed += 1
    return removed


def run_scheduled_backup_if_due() -> dict | None:
    """Run at most one backup per scheduled day and record the outcome."""
    with _BACKUP_LOCK:
        config = get_backup_config()
        if config.get("backup_enabled", "true") not in {"1", "true", "yes", "on"}:
            return None

        try:
            hour, minute = (part.strip() for part in config.get("backup_time", "03:00").split(":", 1))
            scheduled = datetime.now().replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
        except (TypeError, ValueError):
            scheduled = datetime.now().replace(hour=3, minute=0, second=0, microsecond=0)

        last_raw = config.get("backup_last_at", "")
        last = None
        if last_raw:
            try:
                last = datetime.fromisoformat(last_raw)
            except ValueError:
                last = None
        if last and last >= scheduled:
            return None

        try:
            result = create_backup()
        except Exception as exc:  # keep the app alive; surface the error in Settings
            logger.exception("Falha no backup diário automático")
            _write_setting("backup_last_error", str(exc)[:255])
            return None

        _write_setting("backup_last_at", datetime.now().isoformat(timespec="seconds"))
        _write_setting("backup_last_error", "")
        return result


def start_backup_scheduler(app) -> None:
    """Start a tiny stdlib thread; no external scheduler dependency."""
    if app.config.get("TESTING") or not app.config.get("BACKUP_SCHEDULER_ENABLED", True):
        return
    if "backup_scheduler" in app.extensions:
        return
    # Flask's debug reloader would otherwise start the thread twice.
    if app.debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        return

    stop = threading.Event()

    def loop() -> None:
        interval = max(30, int(app.config.get("BACKUP_CHECK_INTERVAL_SECONDS", 60)))
        while not stop.wait(interval):
            try:
                with app.app_context():
                    run_scheduled_backup_if_due()
            except Exception:
                logger.exception("Erro no agendador de backup")

    thread = threading.Thread(target=loop, name="factorpro-backup", daemon=True)
    thread.start()
    app.extensions["backup_scheduler"] = (thread, stop)
