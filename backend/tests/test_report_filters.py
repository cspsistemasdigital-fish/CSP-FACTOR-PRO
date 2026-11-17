"""Saved report filters: CRUD, validation and per-user isolation (Etapa 5)."""
from __future__ import annotations

from datetime import date, timedelta


def _payload(client_id=None, **overrides):
    payload = {
        "name": "Vencidos do mês",
        "filters": {
            "date_from": (date.today() - timedelta(days=30)).isoformat(),
            "date_to": date.today().isoformat(),
            "status": "EM_ABERTO",
            "overdue": True,
            "search": "demo",
        },
    }
    if client_id:
        payload["filters"].update(
            {"client_id": client_id, "client_name": "Cliente Teste Ltda", "client_code": "CLI-0001"}
        )
    payload.update(overrides)
    return payload


def test_saved_filters_crud_and_isolation(client, admin_headers, operator_headers, make_client):
    created_client = make_client()
    response = client.post(
        "/api/reports/filters", json=_payload(created_client["id"]), headers=admin_headers
    )
    assert response.status_code == 201
    item = response.get_json()["item"]
    assert item["name"] == "Vencidos do mês"
    assert item["filters"]["status"] == "EM_ABERTO"
    assert item["filters"]["overdue"] is True
    assert item["filters"]["client_id"] == created_client["id"]
    assert item["filters"]["client_name"] == "Cliente Teste Ltda"

    admin_list = client.get("/api/reports/filters", headers=admin_headers)
    assert admin_list.status_code == 200
    assert len(admin_list.get_json()["items"]) == 1

    operator_list = client.get("/api/reports/filters", headers=operator_headers)
    assert operator_list.get_json()["items"] == []

    forbidden = client.delete(f"/api/reports/filters/{item['id']}", headers=operator_headers)
    assert forbidden.status_code == 404

    removed = client.delete(f"/api/reports/filters/{item['id']}", headers=admin_headers)
    assert removed.status_code == 200
    assert client.get("/api/reports/filters", headers=admin_headers).get_json()["items"] == []
    assert client.delete(
        f"/api/reports/filters/{item['id']}", headers=admin_headers
    ).status_code == 404


def test_saved_filter_validates_period_and_kind(client, admin_headers):
    response = client.post(
        "/api/reports/filters",
        json={
            "name": "Inválido",
            "filters": {
                "date_from": "2026-05-10",
                "date_to": "2026-05-01",
                "kind": "OUTRO",
            },
        },
        headers=admin_headers,
    )
    assert response.status_code == 422
    errors = response.get_json()["errors"]
    assert "date_to" in errors
    assert "kind" in errors


def test_saved_filter_requires_name(client, admin_headers):
    response = client.post(
        "/api/reports/filters", json={"name": "  ", "filters": {}}, headers=admin_headers
    )
    assert response.status_code == 422
    assert "name" in response.get_json()["errors"]


def test_saved_filter_discards_unknown_keys(client, admin_headers):
    response = client.post(
        "/api/reports/filters",
        json={
            "name": "Somente status",
            "filters": {"status": "LIQUIDADO", "unexpected": "value", "client_id": ""},
        },
        headers=admin_headers,
    )
    assert response.status_code == 201
    filters = response.get_json()["item"]["filters"]
    assert filters == {"status": "LIQUIDADO"}


def test_saved_filter_limit_per_user(client, admin_headers):
    for index in range(20):
        response = client.post(
            "/api/reports/filters",
            json={"name": f"Filtro {index + 1}", "filters": {"search": f"busca {index + 1}"}},
            headers=admin_headers,
        )
        assert response.status_code == 201

    blocked = client.post(
        "/api/reports/filters",
        json={"name": "Filtro 21", "filters": {"search": "excedente"}},
        headers=admin_headers,
    )
    assert blocked.status_code == 422
    assert "name" in blocked.get_json()["errors"]
    assert len(client.get("/api/reports/filters", headers=admin_headers).get_json()["items"]) == 20
