"""Etapa 8: backup diário de segurança (configuração, arquivos e permissões)."""
from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZipFile

from app.extensions import db
from app.models import AuditAction, AuditLog, Setting
from app.services.backup import get_backup_config, run_scheduled_backup_if_due


def test_backup_status_returns_defaults_for_admin(client, admin_headers):
    response = client.get("/api/settings/backup", headers=admin_headers)
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["settings"]["backup_enabled"] == "true"
    assert payload["settings"]["backup_time"] == "03:00"
    assert payload["settings"]["backup_retention_days"] == "7"
    assert payload["settings"]["backup_include_uploads"] == "true"
    assert payload["backups"] == []
    assert payload["scheduler_enabled"] is False  # TestingConfig


def test_backup_settings_validate_before_saving(client, admin_headers, app):
    response = client.put(
        "/api/settings/backup",
        json={"backup_time": "99:99", "backup_retention_days": 0},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "backup_time" in response.get_json()["errors"]
    assert "backup_retention_days" in response.get_json()["errors"]
    with app.app_context():
        assert get_backup_config()["backup_time"] == "03:00"


def test_backup_settings_are_persisted_and_audited(client, admin_headers, app):
    response = client.put(
        "/api/settings/backup",
        json={
            "backup_enabled": True,
            "backup_time": "06:30",
            "backup_retention_days": 12,
            "backup_include_uploads": False,
        },
        headers=admin_headers,
    )
    assert response.status_code == 200
    saved = response.get_json()["settings"]
    assert saved["backup_time"] == "06:30"
    assert saved["backup_retention_days"] == "12"
    assert saved["backup_include_uploads"] == "false"

    with app.app_context():
        assert db.session.get(Setting, "backup_time").value == "06:30"
        entry = AuditLog.query.filter_by(entity="settings", description="Backup diário configurado").first()
        assert entry is not None
        assert entry.action == AuditAction.UPDATE


def test_manual_backup_lists_downloads_and_deletes(client, admin_headers, app):
    created = client.post("/api/settings/backup/run", headers=admin_headers)
    assert created.status_code == 200, created.get_json()
    name = created.get_json()["item"]["name"]
    assert name.startswith("backup-") and name.endswith(".zip")
    assert (Path(app.config["BACKUP_FOLDER"]) / name).is_file()

    with ZipFile(Path(app.config["BACKUP_FOLDER"]) / name) as archive:
        entries = archive.namelist()
        database_entry = "database.sqlite" if "database.sqlite" in entries else "database.sql"
        assert database_entry in entries
        assert json.loads(archive.read("manifest.json"))["database"] == database_entry

    listed = client.get("/api/settings/backup", headers=admin_headers).get_json()
    assert any(item["name"] == name for item in listed["backups"])

    downloaded = client.get(f"/api/settings/backup/{name}/download", headers=admin_headers)
    assert downloaded.status_code == 200
    assert downloaded.data[:2] == b"PK"
    downloaded.close()  # Windows keeps the file handle until the response closes

    removed = client.delete(f"/api/settings/backup/{name}", headers=admin_headers)
    assert removed.status_code == 200
    assert not (Path(app.config["BACKUP_FOLDER"]) / name).exists()


def test_scheduled_backup_runs_once_per_day(app):
    with app.app_context():
        row = db.session.get(Setting, "backup_time")
        if not row:
            db.session.add(Setting(key="backup_time", value="00:00"))
        else:
            row.value = "00:00"
        db.session.commit()
        first = run_scheduled_backup_if_due()
        assert first is not None
        second = run_scheduled_backup_if_due()
        assert second is None
        assert get_backup_config()["backup_last_at"]


def test_backup_endpoints_require_admin(client, operator_headers):
    assert client.get("/api/settings/backup", headers=operator_headers).status_code == 200
    assert client.put("/api/settings/backup", json={}, headers=operator_headers).status_code == 403
    assert client.post("/api/settings/backup/run", headers=operator_headers).status_code == 403
    assert client.delete("/api/settings/backup/backup-20260101-000000.zip", headers=operator_headers).status_code == 403
