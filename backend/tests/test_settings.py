"""Brand identity: public payload, editable app name and uploaded logo."""
from __future__ import annotations

import io
import json

from conftest import png_bytes


def _manifest(client):
    return json.loads(client.get("/manifest.webmanifest").data)


def test_public_brand_and_manifest_use_default_name(client):
    brand = client.get("/api/settings/brand")
    assert brand.status_code == 200
    data = brand.get_json()["brand"]
    assert data["app_name"] == "FACTOR PRO"
    assert data["logo_url"] is None
    assert data["background_color"] == "#F7F4EE"

    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert "manifest" in manifest.headers["Content-Type"]
    body = _manifest(client)
    assert body["short_name"] == "FACTOR PRO"
    assert body["icons"][0]["src"] == "/icons/icon-192.png"


def test_admin_can_change_app_name_everywhere(client, admin_headers):
    response = client.put(
        "/api/settings/company",
        json={
            "app_name": "Banco Aurora",
            "company_name": "Aurora Participações S.A.",
            "company_document": "11.222.333/0001-81",
        },
        headers=admin_headers,
    )
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["settings"]["app_name"] == "Banco Aurora"

    assert client.get("/api/settings/brand").get_json()["brand"]["app_name"] == "Banco Aurora"
    assert client.get("/api/health").get_json()["app"] == "Banco Aurora"
    assert _manifest(client)["short_name"] == "Banco Aurora"

    company = client.get("/api/settings/company", headers=admin_headers).get_json()["settings"]
    assert company["company_name"] == "Aurora Participações S.A."
    assert company["app_name"] == "Banco Aurora"


def test_operator_cannot_change_brand(client, operator_headers):
    response = client.put(
        "/api/settings/company", json={"app_name": "Invasor", "company_name": "Invasor Ltda"}, headers=operator_headers
    )
    assert response.status_code == 403
    assert client.post("/api/settings/logo", headers=operator_headers).status_code == 403


def test_logo_upload_serving_and_removal(client, admin_headers):
    upload = client.post(
        "/api/settings/logo",
        data={"file": (io.BytesIO(png_bytes()), "logo-aurora.png")},
        content_type="multipart/form-data",
        headers=admin_headers,
    )
    assert upload.status_code == 200, upload.get_json()
    brand = upload.get_json()["brand"]
    assert brand["logo_url"].startswith("/brand/logo?v=")
    assert brand["logo_name"] == "logo-aurora.png"

    served = client.get(brand["logo_url"])
    assert served.status_code == 200
    assert served.data == png_bytes()

    manifest = _manifest(client)
    assert manifest["icons"][0]["src"] == brand["logo_url"]
    assert manifest["icons"][0]["type"] == "image/png"

    removed = client.delete("/api/settings/logo", headers=admin_headers)
    assert removed.status_code == 200
    assert removed.get_json()["brand"]["logo_url"] is None
    assert client.get(brand["logo_url"]).status_code == 404


def test_logo_rejects_unsupported_and_forged_files(client, admin_headers):
    svg = client.post(
        "/api/settings/logo",
        data={"file": (io.BytesIO(b"<svg onload=alert(1)>"), "logo.svg")},
        content_type="multipart/form-data",
        headers=admin_headers,
    )
    assert svg.status_code == 422
    assert "logo" in svg.get_json()["errors"]

    forged = client.post(
        "/api/settings/logo",
        data={"file": (io.BytesIO(b"not a png at all"), "logo.png")},
        content_type="multipart/form-data",
        headers=admin_headers,
    )
    assert forged.status_code == 422
