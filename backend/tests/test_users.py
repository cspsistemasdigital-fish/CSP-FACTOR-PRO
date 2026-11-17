"""User administration tests."""
from __future__ import annotations


def test_admin_creates_user(client, admin_headers):
    response = client.post(
        "/api/users",
        json={
            "name": "Novo Operador",
            "email": "novo@test.com",
            "role": "OPERATOR",
            "password": "SenhaForte1",
        },
        headers=admin_headers,
    )
    assert response.status_code == 201
    item = response.get_json()["item"]
    assert item["role"] == "OPERATOR"
    assert item["must_change_password"] is True

    login = client.post(
        "/api/auth/login", json={"email": "novo@test.com", "password": "SenhaForte1"}
    )
    assert login.status_code == 200


def test_duplicate_email_is_rejected(client, admin_headers):
    response = client.post(
        "/api/users",
        json={"name": "Duplicado", "email": "admin@test.com", "role": "VIEWER", "password": "SenhaForte1"},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "email" in response.get_json()["errors"]


def test_weak_password_is_rejected(client, admin_headers):
    response = client.post(
        "/api/users",
        json={"name": "Fraco", "email": "fraco@test.com", "role": "VIEWER", "password": "123"},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "password" in response.get_json()["errors"]


def test_admin_updates_role_and_status(client, admin_headers):
    created = client.post(
        "/api/users",
        json={"name": "Alvo", "email": "alvo@test.com", "role": "VIEWER", "password": "SenhaForte1"},
        headers=admin_headers,
    ).get_json()["item"]

    response = client.put(
        f"/api/users/{created['id']}",
        json={"name": "Alvo Dois", "email": "alvo@test.com", "role": "OPERATOR", "is_active": False},
        headers=admin_headers,
    )
    assert response.status_code == 200
    item = response.get_json()["item"]
    assert item["role"] == "OPERATOR"
    assert item["is_active"] is False


def test_admin_resets_user_password(client, admin_headers):
    created = client.post(
        "/api/users",
        json={"name": "Reset", "email": "reset@test.com", "role": "OPERATOR", "password": "SenhaForte1"},
        headers=admin_headers,
    ).get_json()["item"]

    response = client.post(
        f"/api/users/{created['id']}/reset-password",
        json={"password": "NovaSenha22"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert client.post(
        "/api/auth/login", json={"email": "reset@test.com", "password": "NovaSenha22"}
    ).status_code == 200


def test_audit_logs_are_listed(client, admin_headers, make_client):
    make_client()
    response = client.get("/api/users/audit-logs?entity=client", headers=admin_headers)
    body = response.get_json()
    assert response.status_code == 200
    assert body["meta"]["total"] >= 1
    assert body["items"][0]["entity"] == "client"
