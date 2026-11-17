"""Cheque and boleto rules: manual values, divergence alerts, filters, attachments."""
from __future__ import annotations

import io
from datetime import date, timedelta
from pathlib import Path

from app.extensions import db
from app.models import Cheque
from conftest import png_bytes


def test_create_cheque_stores_informed_values(make_client, make_cheque):
    client_item = make_client()
    body = make_cheque(client_item["id"])
    item = body["item"]
    assert item["code"].startswith("CHQ-")
    assert item["nominal_amount"] == 10000.0
    assert item["discount_amount"] == 500.0
    assert item["net_amount"] == 9500.0
    assert item["has_divergence"] is False
    assert body["warnings"] == []


def test_cheque_divergence_generates_warning_without_changing_values(make_client, make_cheque):
    client_item = make_client()
    body = make_cheque(client_item["id"], net_amount="9000.00")
    assert body["item"]["net_amount"] == 9000.0
    assert body["item"]["has_divergence"] is True
    assert body["item"]["divergence_amount"] == 500.0
    assert len(body["warnings"]) == 1
    assert "Divergência" in body["warnings"][0]["message"]


def test_cheque_rejects_negative_values(client, admin_headers, make_client):
    client_item = make_client()
    response = client.post(
        "/api/cheques",
        json={
            "number": "1",
            "bank": "X",
            "client_id": client_item["id"],
            "issuer_document": "529.982.247-25",
            "issuer_name": "Emitente",
            "nominal_amount": "-10",
            "net_amount": "5",
            "due_date": date.today().isoformat(),
            "operation_date": date.today().isoformat(),
        },
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "nominal_amount" in response.get_json()["errors"]


def test_cheque_rejects_net_greater_than_nominal(client, admin_headers, make_client):
    from conftest import cheque_payload

    client_item = make_client()
    payload = cheque_payload(client_item["id"], net_amount="11000.00", discount_amount="0", nominal_amount="10000.00")
    response = client.post("/api/cheques", json=payload, headers=admin_headers)
    assert response.status_code == 422
    assert "net_amount" in response.get_json()["errors"]


def test_cheque_rejects_costs_greater_than_nominal(client, admin_headers, make_client):
    from conftest import cheque_payload

    client_item = make_client()
    payload = cheque_payload(client_item["id"], discount_amount="12000.00", net_amount="0")
    response = client.post("/api/cheques", json=payload, headers=admin_headers)
    assert response.status_code == 422
    assert "discount_amount" in response.get_json()["errors"]


def test_cheque_rejects_due_date_before_issue_date(client, admin_headers, make_client):
    from conftest import cheque_payload

    client_item = make_client()
    payload = cheque_payload(
        client_item["id"],
        issue_date=date.today().isoformat(),
        due_date=(date.today() - timedelta(days=1)).isoformat(),
    )
    response = client.post("/api/cheques", json=payload, headers=admin_headers)
    assert response.status_code == 422
    assert "due_date" in response.get_json()["errors"]


def test_cheque_requires_valid_issuer_document(client, admin_headers, make_client):
    from conftest import cheque_payload

    client_item = make_client()
    payload = cheque_payload(client_item["id"], issuer_document="000.000.000-00")
    response = client.post("/api/cheques", json=payload, headers=admin_headers)
    assert response.status_code == 422
    assert "issuer_document" in response.get_json()["errors"]


def test_inactive_client_cannot_receive_documents(client, admin_headers, make_client):
    client_item = make_client(status="INATIVO")
    from conftest import cheque_payload

    response = client.post(
        "/api/cheques", json=cheque_payload(client_item["id"]), headers=admin_headers
    )
    assert response.status_code == 422
    assert "client_id" in response.get_json()["errors"]


def test_list_cheques_totals_and_filters(client, admin_headers, make_client, make_cheque):
    first = make_client(name="Primeiro")
    second = make_client(name="Segundo", document="529.982.247-25")
    make_cheque(first["id"])
    make_cheque(
        second["id"],
        number="999",
        bank="Itaú",
        status="LIQUIDADO",
        issue_date=(date.today() - timedelta(days=40)).isoformat(),
        due_date=(date.today() - timedelta(days=10)).isoformat(),
        operation_date=(date.today() - timedelta(days=45)).isoformat(),
        nominal_amount="2000.00",
        discount_amount="100.00",
        net_amount="1900.00",
    )

    response = client.get("/api/cheques", headers=admin_headers).get_json()
    assert response["meta"]["total"] == 2
    assert response["totals"]["nominal"] == 12000.0
    assert response["totals"]["net"] == 11400.0
    assert response["totals"]["open"] == 9500.0
    assert response["totals"]["gains"] == 600.0

    liquidados = client.get("/api/cheques?status=LIQUIDADO", headers=admin_headers).get_json()
    assert liquidados["meta"]["total"] == 1

    by_client = client.get(f"/api/cheques?client_id={second['id']}", headers=admin_headers).get_json()
    assert by_client["meta"]["total"] == 1

    by_bank = client.get("/api/cheques?bank=Ita%C3%BA", headers=admin_headers).get_json()
    assert by_bank["meta"]["total"] == 1

    search = client.get("/api/cheques?search=Segundo", headers=admin_headers).get_json()
    assert search["meta"]["total"] == 1


def test_overdue_filter(client, admin_headers, make_client, make_cheque):
    item = make_client()
    make_cheque(
        item["id"],
        due_date=(date.today() - timedelta(days=2)).isoformat(),
        operation_date=(date.today() - timedelta(days=30)).isoformat(),
    )
    response = client.get("/api/cheques?overdue=1", headers=admin_headers).get_json()
    assert response["meta"]["total"] == 1
    assert response["items"][0]["is_overdue"] is True

    vencidos = client.get("/api/cheques?status=VENCIDO", headers=admin_headers).get_json()
    assert vencidos["meta"]["total"] == 1


def test_update_cheque(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    item = make_cheque(client_item["id"])["item"]
    response = client.put(
        f"/api/cheques/{item['id']}",
        json={
            "number": "000777",
            "bank": "Santander",
            "client_id": client_item["id"],
            "issuer_document": "529.982.247-25",
            "issuer_name": "Emitente Atualizado",
            "nominal_amount": "12000.00",
            "discount_amount": "600.00",
            "net_amount": "11400.00",
            "due_date": (date.today() + timedelta(days=40)).isoformat(),
            "operation_date": date.today().isoformat(),
            "status": "EM_ABERTO",
        },
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.get_json()["item"]["nominal_amount"] == 12000.0


def test_status_change_is_audited(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    item = make_cheque(client_item["id"])["item"]
    response = client.patch(
        f"/api/cheques/{item['id']}/status", json={"status": "LIQUIDADO"}, headers=admin_headers
    )
    assert response.status_code == 200
    assert response.get_json()["item"]["status"] == "LIQUIDADO"
    detail = client.get(f"/api/cheques/{item['id']}", headers=admin_headers).get_json()
    assert any(entry["action"] == "STATUS_CHANGE" for entry in detail["history"])


def test_operator_cannot_delete_document(client, operator_headers, make_client, make_cheque):
    client_item = make_client()
    item = make_cheque(client_item["id"])["item"]
    assert client.delete(f"/api/cheques/{item['id']}", headers=operator_headers).status_code == 403


def test_admin_soft_deletes_document(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    item = make_cheque(client_item["id"])["item"]
    assert client.delete(f"/api/cheques/{item['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/cheques/{item['id']}", headers=admin_headers).status_code == 404
    listing = client.get("/api/cheques", headers=admin_headers).get_json()
    assert listing["meta"]["total"] == 0


def test_viewer_cannot_create_document(client, viewer_headers, make_client):
    from conftest import cheque_payload

    client_item = make_client()
    response = client.post(
        "/api/cheques", json=cheque_payload(client_item["id"]), headers=viewer_headers
    )
    assert response.status_code == 403


def test_create_boleto(make_client, make_boleto):
    client_item = make_client()
    body = make_boleto(client_item["id"])
    item = body["item"]
    assert item["code"].startswith("BOL-")
    assert item["original_amount"] == 5000.0
    assert item["net_amount"] == 4750.0
    assert item["has_divergence"] is False


def test_boleto_divergence_and_validation(client, admin_headers, make_client, make_boleto):
    from conftest import boleto_payload

    client_item = make_client()
    body = make_boleto(client_item["id"], net_amount="4000.00")
    assert body["item"]["has_divergence"] is True
    assert body["warnings"]

    bad = boleto_payload(client_item["id"], original_amount="0")
    response = client.post("/api/boletos", json=bad, headers=admin_headers)
    assert response.status_code == 422


def test_boleto_list_and_status(client, admin_headers, make_client, make_boleto):
    client_item = make_client()
    make_boleto(client_item["id"])
    make_boleto(client_item["id"], identifier="BOL-2", status="LIQUIDADO")
    listing = client.get("/api/boletos", headers=admin_headers).get_json()
    assert listing["meta"]["total"] == 2
    assert listing["totals"]["nominal"] == 10000.0
    assert listing["totals"]["open"] == 4750.0


def test_upload_download_and_remove_attachment(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    item = make_cheque(client_item["id"])["item"]

    upload = client.post(
        f"/api/cheques/{item['id']}/attachment",
        data={"file": (io.BytesIO(png_bytes()), "comprovante.png")},
        content_type="multipart/form-data",
        headers=admin_headers,
    )
    assert upload.status_code == 200
    assert upload.get_json()["item"]["has_attachment"] is True

    download = client.get(f"/api/cheques/{item['id']}/attachment", headers=admin_headers)
    assert download.status_code == 200
    assert download.data.startswith(b"\x89PNG")
    download.close()  # release the file handle on Windows

    remove = client.delete(f"/api/cheques/{item['id']}/attachment", headers=admin_headers)
    assert remove.status_code == 200
    assert remove.get_json()["item"]["has_attachment"] is False


def test_attachment_download_rejects_path_traversal(
    app, client, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    item = make_cheque(client_item["id"])["item"]
    outside = Path(app.config["UPLOAD_FOLDER"]).parent / "segredo.pdf"
    outside.write_bytes(b"%PDF-1.4\n")
    try:
        with app.app_context():
            cheque = db.session.get(Cheque, item["id"])
            cheque.attachment_path = "../segredo.pdf"
            db.session.commit()

        response = client.get(
            f"/api/cheques/{item['id']}/attachment", headers=admin_headers
        )
        assert response.status_code == 404
    finally:
        outside.unlink(missing_ok=True)


def test_attachment_rejects_fake_content(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    item = make_cheque(client_item["id"])["item"]
    response = client.post(
        f"/api/cheques/{item['id']}/attachment",
        data={"file": (io.BytesIO(b"nao e um png"), "arquivo.png")},
        content_type="multipart/form-data",
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "attachment" in response.get_json()["errors"]


def test_bank_suggestions(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    make_cheque(client_item["id"], bank="Banco X")
    make_cheque(client_item["id"], bank="Banco Y", number="222")
    banks = client.get("/api/cheques/banks", headers=admin_headers).get_json()["items"]
    assert banks == ["Banco X", "Banco Y"]
