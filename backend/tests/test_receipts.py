"""Receipt (recebimento) rules: manual settlement, partials, estorno and recibo."""
from __future__ import annotations

import io
from datetime import date

from conftest import png_bytes


def receipt_payload(document_kind: str, document_id: int, **overrides) -> dict:
    payload = {
        "document_kind": document_kind,
        "document_id": document_id,
        "receipt_date": date.today().isoformat(),
        "amount": "9500.00",
    }
    payload.update(overrides)
    return payload


def test_partial_receipt_keeps_document_open(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]

    response = client.post(
        "/api/receipts",
        json=receipt_payload("CHEQUE", cheque["id"], amount="4000.00"),
        headers=admin_headers,
    )
    assert response.status_code == 201, response.get_json()
    item = response.get_json()["item"]
    assert item["code"].startswith("REC-")
    assert item["amount"] == 4000.0
    assert item["document_net"] == 9500.0
    assert item["received_total"] == 4000.0
    assert item["remaining_amount"] == 5500.0
    assert item["is_settled"] is False

    document = client.get(f"/api/cheques/{cheque['id']}", headers=admin_headers).get_json()["item"]
    assert document["status"] == "EM_ABERTO"


def test_full_receipt_settles_document_and_is_audited(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    created = client.post(
        "/api/receipts",
        json=receipt_payload("CHEQUE", cheque["id"]),
        headers=admin_headers,
    ).get_json()["item"]

    document = client.get(f"/api/cheques/{cheque['id']}", headers=admin_headers).get_json()
    assert document["item"]["status"] == "LIQUIDADO"
    assert any(entry["action"] == "STATUS_CHANGE" for entry in document["history"])

    detail = client.get(f"/api/receipts/{created['id']}", headers=admin_headers).get_json()
    assert any(entry["action"] == "CREATE" for entry in detail["history"])


def test_receipt_over_balance_generates_warning(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    response = client.post(
        "/api/receipts",
        json=receipt_payload("CHEQUE", cheque["id"], amount="12000.00"),
        headers=admin_headers,
    )
    assert response.status_code == 201
    body = response.get_json()
    assert body["item"]["amount"] == 12000.0
    assert body["warnings"]
    assert "saldo em aberto" in body["warnings"][0]["message"]


def test_estorno_reverts_status_and_is_admin_only(
    client, operator_headers, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    created = client.post(
        "/api/receipts", json=receipt_payload("CHEQUE", cheque["id"]), headers=admin_headers
    ).get_json()["item"]

    assert client.delete(f"/api/receipts/{created['id']}", headers=operator_headers).status_code == 403
    assert client.delete(f"/api/receipts/{created['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/receipts/{created['id']}", headers=admin_headers).status_code == 404

    document = client.get(f"/api/cheques/{cheque['id']}", headers=admin_headers).get_json()["item"]
    assert document["status"] == "EM_ABERTO"


def test_open_documents_lists_balances(client, admin_headers, make_client, make_cheque, make_boleto):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    make_boleto(client_item["id"])
    client.post(
        "/api/receipts",
        json=receipt_payload("CHEQUE", cheque["id"], amount="2000.00"),
        headers=admin_headers,
    )

    response = client.get(
        f"/api/receipts/open-documents?client_id={client_item['id']}", headers=admin_headers
    )
    assert response.status_code == 200
    items = response.get_json()["items"]
    assert len(items) == 2
    cheque_item = next(item for item in items if item["kind"] == "CHEQUE")
    assert cheque_item["received_amount"] == 2000.0
    assert cheque_item["remaining_amount"] == 7500.0


def test_recibo_payload_uses_company_settings(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    created = client.post(
        "/api/receipts",
        json=receipt_payload("CHEQUE", cheque["id"], amount="3000.00"),
        headers=admin_headers,
    ).get_json()["item"]

    response = client.get(f"/api/receipts/{created['id']}/recibo", headers=admin_headers)
    assert response.status_code == 200
    payload = response.get_json()["item"]
    assert payload["number"] == created["code"]
    assert payload["amount"] == 3000.0
    assert payload["document"]["code"] == cheque["code"]
    assert payload["client"]["id"] == client_item["id"]
    assert payload["company"]["company_name"]


def test_receipt_attachment_roundtrip(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    created = client.post(
        "/api/receipts", json=receipt_payload("CHEQUE", cheque["id"]), headers=admin_headers
    ).get_json()["item"]

    upload = client.post(
        f"/api/receipts/{created['id']}/attachment",
        data={"file": (io.BytesIO(png_bytes()), "comprovante.png")},
        content_type="multipart/form-data",
        headers=admin_headers,
    )
    assert upload.status_code == 200
    assert upload.get_json()["item"]["has_attachment"] is True

    download = client.get(f"/api/receipts/{created['id']}/attachment", headers=admin_headers)
    assert download.status_code == 200
    assert download.data.startswith(b"\x89PNG")
    download.close()


def test_document_delete_blocked_when_receipt_exists(
    client, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    client.post(
        "/api/receipts", json=receipt_payload("CHEQUE", cheque["id"]), headers=admin_headers
    )
    response = client.delete(f"/api/cheques/{cheque['id']}", headers=admin_headers)
    assert response.status_code == 422
    assert "document" in response.get_json()["errors"]


def test_receipt_validation(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]

    missing = client.post(
        "/api/receipts", json={"amount": "10.00"}, headers=admin_headers
    )
    assert missing.status_code == 422
    assert "document_kind" in missing.get_json()["errors"]

    zero = client.post(
        "/api/receipts",
        json=receipt_payload("CHEQUE", cheque["id"], amount="0"),
        headers=admin_headers,
    )
    assert zero.status_code == 422
    assert "amount" in zero.get_json()["errors"]


def test_list_receipts_totals_and_filters(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    client.post(
        "/api/receipts", json=receipt_payload("CHEQUE", cheque["id"], amount="1000.00"), headers=admin_headers
    )
    client.post(
        "/api/receipts", json=receipt_payload("CHEQUE", cheque["id"], amount="1500.00"), headers=admin_headers
    )

    listing = client.get("/api/receipts", headers=admin_headers).get_json()
    assert listing["meta"]["total"] == 2
    assert listing["totals"]["amount"] == 2500.0

    by_doc = client.get(
        f"/api/receipts?document_kind=CHEQUE&document_id={cheque['id']}", headers=admin_headers
    ).get_json()
    assert by_doc["meta"]["total"] == 2


def test_viewer_cannot_create_receipt(client, viewer_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    response = client.post(
        "/api/receipts",
        json=receipt_payload("CHEQUE", cheque["id"]),
        headers=viewer_headers,
    )
    assert response.status_code == 403
