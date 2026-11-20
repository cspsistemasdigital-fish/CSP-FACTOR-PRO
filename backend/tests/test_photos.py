"""Etapa 8: captura sequencial de múltiplas fotos em cheques/boletos/recebimentos."""
from __future__ import annotations

import io
from datetime import date

from conftest import png_bytes


def _upload(client, url, headers, count: int):
    """Upload *count* valid PNG photos in a single multipart request."""
    data = {
        "files": [
            (io.BytesIO(png_bytes()), f"foto-{index}.png", "image/png")
            for index in range(count)
        ]
    }
    return client.post(url, data=data, headers=headers, content_type="multipart/form-data")


def test_upload_capture_and_remove_more_than_four_photos(client, admin_headers, make_client, make_cheque):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]

    uploaded = _upload(client, f"/api/cheques/{cheque['id']}/photos", admin_headers, 6)
    assert uploaded.status_code == 200, uploaded.get_json()
    assert len(uploaded.get_json()["items"]) == 6
    assert "6 foto(s)" in uploaded.get_json()["message"]

    listed = client.get(f"/api/cheques/{cheque['id']}/photos", headers=admin_headers).get_json()["items"]
    assert len(listed) == 6
    assert all(item["name"].startswith("foto-") for item in listed)

    first_id = listed[0]["id"]
    downloaded = client.get(
        f"/api/cheques/{cheque['id']}/photos/{first_id}", headers=admin_headers
    )
    assert downloaded.status_code == 200
    assert downloaded.data[:8] == b"\x89PNG\r\n\x1a\n"
    downloaded.close()

    removed = client.delete(
        f"/api/cheques/{cheque['id']}/photos/{first_id}", headers=admin_headers
    )
    assert removed.status_code == 200
    remaining = client.get(f"/api/cheques/{cheque['id']}/photos", headers=admin_headers).get_json()["items"]
    assert len(remaining) == 5
    assert all(item["id"] != first_id for item in remaining)


def test_photos_are_isolated_between_documents(client, admin_headers, make_client, make_cheque):
    owner = make_client()
    first = make_cheque(owner["id"])["item"]
    second = make_cheque(owner["id"])["item"]

    assert _upload(client, f"/api/cheques/{first['id']}/photos", admin_headers, 2).status_code == 200
    assert client.get(f"/api/cheques/{second['id']}/photos", headers=admin_headers).get_json()["items"] == []

    first_photo = client.get(f"/api/cheques/{first['id']}/photos", headers=admin_headers).get_json()["items"][0]
    stolen = client.delete(
        f"/api/cheques/{second['id']}/photos/{first_photo['id']}", headers=admin_headers
    )
    assert stolen.status_code == 404
    assert len(client.get(f"/api/cheques/{first['id']}/photos", headers=admin_headers).get_json()["items"]) == 2


def test_photos_work_for_boletos_and_receipts(
    client, admin_headers, make_client, make_boleto
):
    owner = make_client()
    boleto = make_boleto(owner["id"])["item"]
    assert _upload(client, f"/api/boletos/{boleto['id']}/photos", admin_headers, 5).status_code == 200
    assert len(client.get(f"/api/boletos/{boleto['id']}/photos", headers=admin_headers).get_json()["items"]) == 5

    receipt = client.post(
        "/api/receipts",
        json={
            "document_kind": "BOLETO",
            "document_id": boleto["id"],
            "receipt_date": date.today().isoformat(),
            "amount": "1000.00",
        },
        headers=admin_headers,
    ).get_json()["item"]
    assert _upload(client, f"/api/receipts/{receipt['id']}/photos", admin_headers, 5).status_code == 200
    assert len(client.get(f"/api/receipts/{receipt['id']}/photos", headers=admin_headers).get_json()["items"]) == 5


def test_photo_upload_requires_file_and_operator_role(
    client, admin_headers, operator_headers, viewer_headers, make_client, make_cheque
):
    owner = make_client()
    cheque = make_cheque(owner["id"])["item"]

    empty = client.post(
        f"/api/cheques/{cheque['id']}/photos", data={}, headers=admin_headers,
        content_type="multipart/form-data",
    )
    assert empty.status_code == 422
    assert "files" in empty.get_json()["errors"]

    denied = client.post(
        f"/api/cheques/{cheque['id']}/photos",
        data={"files": (io.BytesIO(png_bytes()), "foto.png", "image/png")},
        headers=viewer_headers,
        content_type="multipart/form-data",
    )
    assert denied.status_code == 403

    allowed = client.post(
        f"/api/cheques/{cheque['id']}/photos",
        data={"files": (io.BytesIO(png_bytes()), "foto.png", "image/png")},
        headers=operator_headers,
        content_type="multipart/form-data",
    )
    assert allowed.status_code == 200
