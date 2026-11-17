"""Authentication, session and permission tests."""
from __future__ import annotations


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_login_success(client):
    response = client.post(
        "/api/auth/login", json={"email": "admin@test.com", "password": "Senha1234"}
    )
    body = response.get_json()
    assert response.status_code == 200
    assert body["access_token"]
    assert body["user"]["role"] == "ADMIN"


def test_login_invalid_password(client):
    response = client.post("/api/auth/login", json={"email": "admin@test.com", "password": "errada"})
    assert response.status_code == 401
    assert response.get_json()["message"] == "E-mail ou senha inválidos."


def test_login_unknown_email(client):
    response = client.post("/api/auth/login", json={"email": "nada@test.com", "password": "Senha1234"})
    assert response.status_code == 401


def test_login_inactive_user(client):
    response = client.post("/api/auth/login", json={"email": "inativo@test.com", "password": "Senha1234"})
    assert response.status_code == 403


def test_login_requires_fields(client):
    response = client.post("/api/auth/login", json={"email": ""})
    assert response.status_code == 422
    assert "email" in response.get_json()["errors"]


def test_me_requires_authentication(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_returns_current_user(client, admin_headers):
    response = client.get("/api/auth/me", headers=admin_headers)
    assert response.status_code == 200
    assert response.get_json()["user"]["email"] == "admin@test.com"


def test_refresh_token_flow(client):
    login = client.post("/api/auth/login", json={"email": "admin@test.com", "password": "Senha1234"})
    assert login.status_code == 200
    refresh = client.post("/api/auth/refresh")
    assert refresh.status_code == 200
    assert refresh.get_json()["access_token"]


def test_logout_invalidates_refresh_cookie(client):
    client.post("/api/auth/login", json={"email": "admin@test.com", "password": "Senha1234"})
    assert client.post("/api/auth/logout").status_code == 200
    assert client.post("/api/auth/refresh").status_code == 401


def test_change_password(client, admin_headers):
    response = client.post(
        "/api/auth/change-password",
        json={"current_password": "Senha1234", "new_password": "NovaSenha99"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert client.post(
        "/api/auth/login", json={"email": "admin@test.com", "password": "NovaSenha99"}
    ).status_code == 200


def test_change_password_rejects_wrong_current(client, admin_headers):
    response = client.post(
        "/api/auth/change-password",
        json={"current_password": "errada", "new_password": "NovaSenha99"},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "current_password" in response.get_json()["errors"]


def test_forgot_and_reset_password(client):
    forgot = client.post("/api/auth/forgot-password", json={"email": "operador@test.com"})
    assert forgot.status_code == 200
    token = forgot.get_json()["reset_token"]

    reset = client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "OutraSenha77"}
    )
    assert reset.status_code == 200
    assert client.post(
        "/api/auth/login", json={"email": "operador@test.com", "password": "OutraSenha77"}
    ).status_code == 200


def test_forgot_password_unknown_email_is_generic(client):
    response = client.post("/api/auth/forgot-password", json={"email": "ninguem@test.com"})
    assert response.status_code == 200
    assert "reset_token" not in response.get_json()


def test_reset_token_single_use(client):
    token = client.post(
        "/api/auth/forgot-password", json={"email": "operador@test.com"}
    ).get_json()["reset_token"]
    assert client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "Primeira123"}
    ).status_code == 200
    assert client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "Segunda123"}
    ).status_code == 400


def test_viewer_cannot_write(client, viewer_headers):
    response = client.post(
        "/api/clients",
        json={"name": "Bloqueado", "document": "529.982.247-25"},
        headers=viewer_headers,
    )
    assert response.status_code == 403


def test_viewer_cannot_manage_users(client, viewer_headers):
    assert client.get("/api/users", headers=viewer_headers).status_code == 403


def test_operator_cannot_manage_users(client, operator_headers):
    assert client.get("/api/users", headers=operator_headers).status_code == 403


def test_admin_cannot_deactivate_self(client, admin_headers):
    me = client.get("/api/auth/me", headers=admin_headers).get_json()["user"]
    response = client.put(
        f"/api/users/{me['id']}",
        json={"name": me["name"], "email": me["email"], "role": "ADMIN", "is_active": False},
        headers=admin_headers,
    )
    assert response.status_code == 400
