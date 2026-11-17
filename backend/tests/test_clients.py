"""Client CRUD, duplicate prevention and limit summary tests."""
from __future__ import annotations

from app.models import Client


def test_create_client_generates_code_and_normalizes_document(client, admin_headers, make_client):
    item = make_client(name="Empresa Exemplo", document="11.222.333/0001-81")
    assert item["code"].startswith("CLI-")
    assert item["document"] == "11222333000181"
    assert item["person_type"] == "PJ"
    assert item["summary"]["available_limit"] == 50000.0


def test_create_client_with_cpf(make_client):
    item = make_client(name="João da Silva", document="529.982.247-25")
    assert item["document"] == "52998224725"
    assert item["person_type"] == "PF"


def test_create_client_with_alphanumeric_cnpj(make_client):
    item = make_client(name="Empresa Alfanumérica", document="12.ABC.345/01DE-35")
    assert item["document"] == "12ABC34501DE35"
    assert item["person_type"] == "PJ"


def test_duplicate_document_is_rejected(client, admin_headers, make_client):
    make_client(document="11.222.333/0001-81")
    response = client.post(
        "/api/clients",
        json={"name": "Outra Empresa", "document": "11222333000181"},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "document" in response.get_json()["errors"]


def test_invalid_cpf_is_rejected(client, admin_headers):
    response = client.post(
        "/api/clients",
        json={"name": "CPF Inválido", "document": "111.111.111-11"},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "CPF" in response.get_json()["errors"]["document"]


def test_invalid_email_is_rejected(client, admin_headers):
    response = client.post(
        "/api/clients",
        json={"name": "Cliente", "document": "529.982.247-25", "email": "nao-e-email"},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "email" in response.get_json()["errors"]


def test_client_requires_authentication(client):
    assert client.get("/api/clients").status_code == 401


def test_list_and_search_clients(client, admin_headers, make_client):
    make_client(name="Alfa Comércio", document="11.222.333/0001-81")
    make_client(name="Beta Serviços", document="529.982.247-25", email="beta@test.com")

    response = client.get("/api/clients?search=Alfa", headers=admin_headers)
    body = response.get_json()
    assert response.status_code == 200
    assert body["meta"]["total"] == 1
    assert body["items"][0]["name"] == "Alfa Comércio"

    search_document = client.get("/api/clients?search=529982", headers=admin_headers).get_json()
    assert search_document["meta"]["total"] == 1


def test_filter_clients_by_status(client, admin_headers, make_client):
    make_client(name="Ativo Um")
    make_client(name="Inativo Um", document="529.982.247-25", status="INATIVO")
    response = client.get("/api/clients?status=INATIVO", headers=admin_headers).get_json()
    assert response["meta"]["total"] == 1
    assert response["items"][0]["status"] == "INATIVO"


def test_update_client(client, admin_headers, make_client):
    item = make_client()
    response = client.put(
        f"/api/clients/{item['id']}",
        json={
            "name": "Cliente Atualizado",
            "document": item["document"],
            "operational_limit": "75000.00",
            "status": "INATIVO",
            "city": "Rio de Janeiro",
            "state": "RJ",
        },
        headers=admin_headers,
    )
    assert response.status_code == 200
    updated = response.get_json()["item"]
    assert updated["name"] == "Cliente Atualizado"
    assert updated["operational_limit"] == 75000.0
    assert updated["status"] == "INATIVO"
    assert updated["city"] == "Rio de Janeiro"


def test_client_summary_reflects_open_documents(client, admin_headers, make_client, make_cheque):
    item = make_client()
    make_cheque(item["id"])
    detail = client.get(f"/api/clients/{item['id']}", headers=admin_headers).get_json()["item"]
    assert detail["summary"]["open_amount"] == 9500.0
    assert detail["summary"]["open_documents"] == 1
    assert detail["summary"]["available_limit"] == 40500.0
    assert detail["summary"]["limit_exceeded"] is False


def test_client_history_lists_documents(client, admin_headers, make_client, make_cheque):
    item = make_client()
    make_cheque(item["id"])
    response = client.get(f"/api/clients/{item['id']}/history", headers=admin_headers)
    body = response.get_json()
    assert response.status_code == 200
    assert body["totals"]["count"] == 1
    assert body["documents"][0]["kind"] == "CHEQUE"
    assert any(entry["type"] == "document" for entry in body["timeline"])


def test_client_history_supports_boletos(client, admin_headers, make_client, make_boleto):
    item = make_client()
    make_boleto(item["id"])
    response = client.get(f"/api/clients/{item['id']}/history", headers=admin_headers)
    body = response.get_json()
    assert response.status_code == 200
    assert body["totals"]["count"] == 1
    assert body["totals"]["nominal"] == 5000.0
    assert body["documents"][0]["kind"] == "BOLETO"


def test_delete_client_with_open_documents_is_blocked(
    client, admin_headers, make_client, make_cheque
):
    item = make_client()
    make_cheque(item["id"])
    response = client.delete(f"/api/clients/{item['id']}", headers=admin_headers)
    assert response.status_code == 422
    assert "client" in response.get_json()["errors"]


def test_soft_delete_client(client, admin_headers, make_client, app):
    item = make_client()
    assert client.delete(f"/api/clients/{item['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/clients/{item['id']}", headers=admin_headers).status_code == 404
    with app.app_context():
        stored = app.extensions["sqlalchemy"].session.get(Client, item["id"])
        assert stored.is_deleted is True


def test_operator_cannot_delete_client(client, operator_headers, make_client):
    item = make_client()
    assert client.delete(f"/api/clients/{item['id']}", headers=operator_headers).status_code == 403


def test_viewer_can_read(client, viewer_headers, make_client):
    make_client()
    assert client.get("/api/clients", headers=viewer_headers).status_code == 200


def test_client_options_only_active(client, admin_headers, make_client):
    make_client(name="Ativo Opções")
    make_client(name="Inativo Opções", document="529.982.247-25", status="INATIVO")
    response = client.get("/api/clients/options", headers=admin_headers).get_json()
    assert len(response["items"]) == 1
    assert response["items"][0]["name"] == "Ativo Opções"
