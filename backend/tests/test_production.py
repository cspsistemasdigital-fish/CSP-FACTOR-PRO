"""Etapa 4 — production hardening: e-mail delivery and shared throttling."""
from __future__ import annotations

import pytest

from app import create_app
from app.config import ProductionConfig
from app.services.email import build_reset_email
from app.utils import security


class FakeRedis:
    """Minimal sorted-set client used to exercise the Redis throttling path."""

    def __init__(self):
        self.sets: dict[str, dict[str, float]] = {}
        self.expirations: dict[str, int] = {}

    def zadd(self, key, mapping):
        self.sets.setdefault(key, {}).update(mapping)
        return len(mapping)

    def zremrangebyscore(self, key, minimum, maximum):
        bucket = self.sets.get(key, {})
        for member in [m for m, score in bucket.items() if score <= maximum]:
            bucket.pop(member, None)
        return 0

    def zcard(self, key):
        return len(self.sets.get(key, {}))

    def expire(self, key, seconds):
        self.expirations[key] = seconds
        return True

    def delete(self, key):
        self.sets.pop(key, None)
        self.expirations.pop(key, None)
        return 1


class BrokenRedis:
    def zremrangebyscore(self, *args, **kwargs):
        raise RuntimeError("redis offline")

    def zcard(self, *args, **kwargs):
        raise RuntimeError("redis offline")


def test_reset_email_contains_edit_free_link(app):
    with app.app_context():
        message = build_reset_email(
            "cliente@test.com",
            "Cliente Teste",
            "http://127.0.0.1:5000/redefinir-senha?token=abc123",
        )
        body = message.get_content()
        assert message["Subject"] == "FACTOR PRO — recuperação de senha"
        assert "Cliente Teste" in body
        assert "http://127.0.0.1:5000/redefinir-senha?token=abc123" in body
        assert "30 minutos" in body
        assert "senha atual continua válida" in body


def test_forgot_password_uses_configured_email(client, app, monkeypatch):
    app.config.update(MAIL_SERVER="smtp.test.local")
    calls: list[tuple[str, str, str]] = []

    def fake_send(to_email, name, reset_url):
        calls.append((to_email, name, reset_url))
        return True

    monkeypatch.setattr("app.api.auth.send_password_reset_email", fake_send)

    response = client.post("/api/auth/forgot-password", json={"email": "operador@test.com"})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["email_sent"] is True
    assert calls and calls[0][0] == "operador@test.com"
    assert "/redefinir-senha?token=" in calls[0][2]
    assert payload["reset_token"]


def test_forgot_password_survives_email_failure(client, app, monkeypatch):
    app.config.update(MAIL_SERVER="smtp.test.local")

    def failing_send(*args, **kwargs):
        raise RuntimeError("smtp down")

    monkeypatch.setattr("app.api.auth.send_password_reset_email", failing_send)

    response = client.post("/api/auth/forgot-password", json={"email": "operador@test.com"})
    assert response.status_code == 200
    assert response.get_json()["email_sent"] is False
    assert "reset_token" in response.get_json()


def test_login_throttling_uses_redis_store(client, app, monkeypatch):
    url = "redis://fake:6379/0"
    fake = FakeRedis()
    monkeypatch.setitem(security._clients, url, fake)
    app.config.update(
        RATE_LIMIT_STORAGE_URL=url,
        LOGIN_MAX_ATTEMPTS=2,
        LOGIN_WINDOW_SECONDS=300,
    )

    first = client.post("/api/auth/login", json={"email": "operador@test.com", "password": "errada"})
    second = client.post("/api/auth/login", json={"email": "operador@test.com", "password": "errada"})
    blocked = client.post("/api/auth/login", json={"email": "operador@test.com", "password": "Senha1234"})

    assert first.status_code == 401
    assert second.status_code == 401
    assert blocked.status_code == 429
    keys = list(fake.sets)
    assert len(keys) == 1
    assert fake.zcard(keys[0]) == 2
    assert fake.expirations[keys[0]] == 301


def test_login_throttling_falls_back_when_redis_fails(client, app, monkeypatch):
    url = "redis://broken:6379/0"
    monkeypatch.setitem(security._clients, url, BrokenRedis())
    app.config.update(
        RATE_LIMIT_STORAGE_URL=url,
        LOGIN_MAX_ATTEMPTS=2,
        LOGIN_WINDOW_SECONDS=300,
    )

    assert client.post(
        "/api/auth/login", json={"email": "operador@test.com", "password": "errada"}
    ).status_code == 401
    assert client.post(
        "/api/auth/login", json={"email": "operador@test.com", "password": "errada"}
    ).status_code == 401
    assert client.post(
        "/api/auth/login", json={"email": "operador@test.com", "password": "Senha1234"}
    ).status_code == 429


def test_production_requires_mail_server(monkeypatch):
    monkeypatch.setattr(
        ProductionConfig,
        "SQLALCHEMY_DATABASE_URI",
        "postgresql+psycopg2://factorpro:secret@localhost:5432/factorpro",
    )
    monkeypatch.setattr(ProductionConfig, "SECRET_KEY", "production-secret-key-with-32-bytes")
    monkeypatch.setattr(ProductionConfig, "MAIL_SERVER", "")

    with pytest.raises(RuntimeError, match="MAIL_SERVER"):
        create_app("production")
