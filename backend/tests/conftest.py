"""Pytest fixtures for the FACTOR PRO backend."""
from __future__ import annotations

import io
import os
from datetime import date, timedelta
from pathlib import Path

import pytest

from app import create_app
from app.extensions import db
from app.models import Role, User
from app.utils.security import reset_throttle


@pytest.fixture()
def app(tmp_path, monkeypatch):
    database_path = tmp_path / "test.db"
    monkeypatch.setenv("TEST_DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    application = create_app("testing")
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    application.config.update(
        UPLOAD_FOLDER=str(uploads),
        EXPOSE_RESET_TOKEN=True,
    )

    with application.app_context():
        db.create_all()
        users = [
            ("Administrador Teste", "admin@test.com", Role.ADMIN),
            ("Operador Teste", "operador@test.com", Role.OPERATOR),
            ("Consultor Teste", "consultor@test.com", Role.VIEWER),
            ("Usuário Inativo", "inativo@test.com", Role.OPERATOR),
        ]
        for name, email, role in users:
            user = User(name=name, email=email, role=role, is_active=True)
            user.set_password("Senha1234")
            if email == "inativo@test.com":
                user.is_active = False
            db.session.add(user)
        db.session.commit()
        reset_throttle()

    yield application

    with application.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def login(client):
    def _login(email: str, password: str = "Senha1234") -> dict:
        response = client.post("/api/auth/login", json={"email": email, "password": password})
        assert response.status_code == 200, response.get_json()
        token = response.get_json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _login


@pytest.fixture()
def admin_headers(login):
    return login("admin@test.com")


@pytest.fixture()
def operator_headers(login):
    return login("operador@test.com")


@pytest.fixture()
def viewer_headers(login):
    return login("consultor@test.com")


@pytest.fixture()
def make_client(client, admin_headers):
    def _make(**overrides) -> dict:
        payload = {
            "name": "Cliente Teste Ltda",
            "document": "11.222.333/0001-81",
            "email": "cliente@test.com",
            "phone": "(11) 98888-7777",
            "city": "São Paulo",
            "state": "SP",
            "zip_code": "01310-100",
            "operational_limit": "50000.00",
            "status": "ATIVO",
        }
        payload.update(overrides)
        response = client.post("/api/clients", json=payload, headers=admin_headers)
        assert response.status_code == 201, response.get_json()
        return response.get_json()["item"]

    return _make


def cheque_payload(client_id: int, **overrides) -> dict:
    payload = {
        "number": "000123",
        "bank": "Banco do Brasil",
        "agency": "1234",
        "account": "56789-0",
        "identifier": "CHQ-TESTE",
        "client_id": client_id,
        "issuer_document": "529.982.247-25",
        "issuer_name": "Emitente Teste",
        "nominal_amount": "10000.00",
        "discount_amount": "500.00",
        "interest_amount": "0.00",
        "other_expenses": "0.00",
        "net_amount": "9500.00",
        "issue_date": (date.today() - timedelta(days=5)).isoformat(),
        "due_date": (date.today() + timedelta(days=25)).isoformat(),
        "operation_date": date.today().isoformat(),
        "status": "EM_ABERTO",
    }
    payload.update(overrides)
    return payload


def boleto_payload(client_id: int, **overrides) -> dict:
    payload = {
        "identifier": "BOL-TESTE-001",
        "barcode": "00190500954014481606906809350314337370000000100",
        "bank": "Banco do Brasil",
        "client_id": client_id,
        "beneficiary_document": "11.222.333/0001-81",
        "beneficiary_name": "Cliente Teste Ltda",
        "original_amount": "5000.00",
        "discount_amount": "250.00",
        "other_expenses": "0.00",
        "net_amount": "4750.00",
        "issue_date": (date.today() - timedelta(days=3)).isoformat(),
        "due_date": (date.today() + timedelta(days=20)).isoformat(),
        "operation_date": date.today().isoformat(),
        "status": "EM_ABERTO",
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def make_cheque(client, admin_headers):
    def _make(client_id: int, **overrides) -> dict:
        response = client.post("/api/cheques", json=cheque_payload(client_id, **overrides), headers=admin_headers)
        assert response.status_code == 201, response.get_json()
        return response.get_json()

    return _make


@pytest.fixture()
def make_boleto(client, admin_headers):
    def _make(client_id: int, **overrides) -> dict:
        response = client.post("/api/boletos", json=boleto_payload(client_id, **overrides), headers=admin_headers)
        assert response.status_code == 201, response.get_json()
        return response.get_json()

    return _make


def png_bytes() -> bytes:
    """Minimal valid 1x1 PNG."""
    import base64

    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
