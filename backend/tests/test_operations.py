"""Operation (borderô) rules: grouping, derived totals, limits and audit."""
from __future__ import annotations

from datetime import date, timedelta

from conftest import boleto_payload, cheque_payload


def operation_payload(client_id: int, documents: list[dict], **overrides) -> dict:
    payload = {
        "client_id": client_id,
        "operation_date": date.today().isoformat(),
        "description": "Borderô de teste",
        "documents": documents,
    }
    payload.update(overrides)
    return payload


def test_create_operation_groups_documents_and_derives_totals(
    client, admin_headers, make_client, make_cheque, make_boleto
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    boleto = make_boleto(client_item["id"])["item"]

    response = client.post(
        "/api/operations",
        json=operation_payload(
            client_item["id"],
            [{"kind": "CHEQUE", "id": cheque["id"]}, {"kind": "BOLETO", "id": boleto["id"]}],
        ),
        headers=admin_headers,
    )
    assert response.status_code == 201, response.get_json()
    item = response.get_json()["item"]
    assert item["code"].startswith("OPR-")
    assert item["documents_count"] == 2
    # Derived from the documents: cheque 10000/9500 + boleto 5000/4750
    assert item["totals"]["nominal"] == 15000.0
    assert item["totals"]["net"] == 14250.0
    assert item["totals"]["costs"] == 750.0
    assert item["status"] == "ABERTA"

    # The documents now point to the operation.
    detail = client.get(f"/api/cheques/{cheque['id']}", headers=admin_headers).get_json()["item"]
    assert detail["operation_id"] == item["id"]
    assert detail["operation"]["code"] == item["code"]


def test_operation_rejects_documents_from_another_client(
    client, admin_headers, make_client, make_cheque
):
    first = make_client(name="Primeiro")
    second = make_client(name="Segundo", document="529.982.247-25")
    cheque = make_cheque(first["id"])["item"]

    response = client.post(
        "/api/operations",
        json=operation_payload(second["id"], [{"kind": "CHEQUE", "id": cheque["id"]}]),
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "documents" in response.get_json()["errors"]


def test_document_cannot_belong_to_two_operations(
    client, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    first = client.post(
        "/api/operations",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": cheque["id"]}]),
        headers=admin_headers,
    )
    assert first.status_code == 201

    second = client.post(
        "/api/operations",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": cheque["id"]}]),
        headers=admin_headers,
    )
    assert second.status_code == 422
    assert "documents" in second.get_json()["errors"]


def test_available_documents_excludes_linked(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    linked = make_cheque(client_item["id"])["item"]
    free = make_cheque(client_item["id"], number="000999")["item"]
    client.post(
        "/api/operations",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": linked["id"]}]),
        headers=admin_headers,
    )
    response = client.get(
        f"/api/operations/available-documents?client_id={client_item['id']}", headers=admin_headers
    )
    assert response.status_code == 200
    ids = [item["id"] for item in response.get_json()["items"]]
    assert free["id"] in ids
    assert linked["id"] not in ids


def test_update_operation_removes_document(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    first = make_cheque(client_item["id"])["item"]
    second = make_cheque(client_item["id"], number="000456")["item"]
    created = client.post(
        "/api/operations",
        json=operation_payload(
            client_item["id"],
            [{"kind": "CHEQUE", "id": first["id"]}, {"kind": "CHEQUE", "id": second["id"]}],
        ),
        headers=admin_headers,
    ).get_json()["item"]

    response = client.put(
        f"/api/operations/{created['id']}",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": first["id"]}]),
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.get_json()["item"]["documents_count"] == 1

    released = client.get(f"/api/cheques/{second['id']}", headers=admin_headers).get_json()["item"]
    assert released["operation_id"] is None


def test_operation_status_change_is_audited(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    created = client.post(
        "/api/operations",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": cheque["id"]}]),
        headers=admin_headers,
    ).get_json()["item"]

    response = client.patch(
        f"/api/operations/{created['id']}/status", json={"status": "FECHADA"}, headers=admin_headers
    )
    assert response.status_code == 200
    assert response.get_json()["item"]["status"] == "FECHADA"

    detail = client.get(f"/api/operations/{created['id']}", headers=admin_headers).get_json()
    assert any(entry["action"] == "STATUS_CHANGE" for entry in detail["history"])
    assert any(entry["action"] == "CREATE" for entry in detail["history"])


def test_operator_cannot_delete_operation_but_admin_can(
    client, operator_headers, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    created = client.post(
        "/api/operations",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": cheque["id"]}]),
        headers=admin_headers,
    ).get_json()["item"]

    assert client.delete(f"/api/operations/{created['id']}", headers=operator_headers).status_code == 403
    assert client.delete(f"/api/operations/{created['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/operations/{created['id']}", headers=admin_headers).status_code == 404

    released = client.get(f"/api/cheques/{cheque['id']}", headers=admin_headers).get_json()["item"]
    assert released["operation_id"] is None


def test_viewer_cannot_create_operation(client, viewer_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    response = client.post(
        "/api/operations",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": cheque["id"]}]),
        headers=viewer_headers,
    )
    assert response.status_code == 403


def test_inactive_client_cannot_receive_operation(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    # Deactivate the client after the cheque exists.
    client.put(
        f"/api/clients/{client_item['id']}",
        json={
            "name": client_item["name"],
            "document": "11.222.333/0001-81",
            "status": "INATIVO",
            "operational_limit": "50000.00",
        },
        headers=admin_headers,
    )
    response = client.post(
        "/api/operations",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": cheque["id"]}]),
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "client_id" in response.get_json()["errors"]


def test_list_operations_totals_and_filters(client, admin_headers, make_client, make_cheque):
    first = make_client(name="Primeiro")
    second = make_client(name="Segundo", document="529.982.247-25")
    cheque_a = make_cheque(first["id"])["item"]
    cheque_b = make_cheque(second["id"], number="000456")["item"]
    client.post(
        "/api/operations",
        json=operation_payload(first["id"], [{"kind": "CHEQUE", "id": cheque_a["id"]}]),
        headers=admin_headers,
    )
    client.post(
        "/api/operations",
        json=operation_payload(second["id"], [{"kind": "CHEQUE", "id": cheque_b["id"]}]),
        headers=admin_headers,
    )

    listing = client.get("/api/operations", headers=admin_headers).get_json()
    assert listing["meta"]["total"] == 2
    assert listing["totals"]["operations"] == 2
    assert listing["totals"]["documents"] == 2
    assert listing["totals"]["nominal"] == 20000.0

    by_client = client.get(f"/api/operations?client_id={second['id']}", headers=admin_headers).get_json()
    assert by_client["meta"]["total"] == 1

    search = client.get("/api/operations?search=Primeiro", headers=admin_headers).get_json()
    assert search["meta"]["total"] == 1


def test_delete_client_blocked_when_operation_exists(
    client, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    client.post(
        "/api/operations",
        json=operation_payload(client_item["id"], [{"kind": "CHEQUE", "id": cheque["id"]}]),
        headers=admin_headers,
    )
    response = client.delete(f"/api/clients/{client_item['id']}", headers=admin_headers)
    assert response.status_code == 422
    assert "client" in response.get_json()["errors"]


def test_operation_requires_documents_list(client, admin_headers, make_client):
    client_item = make_client()
    response = client.post(
        "/api/operations",
        json={"client_id": client_item["id"], "operation_date": date.today().isoformat()},
        headers=admin_headers,
    )
    # An empty list is allowed (a batch may be created before adding documents).
    assert response.status_code == 201
    assert response.get_json()["item"]["documents_count"] == 0
