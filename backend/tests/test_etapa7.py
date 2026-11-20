"""Etapa 7: Relatório Geral unificado e identidade visual personalizável."""
from __future__ import annotations

from datetime import date, timedelta
from io import BytesIO
from zipfile import ZipFile

import pytest

from conftest import png_bytes


def _loan_payload(client_id: int, **overrides) -> dict:
    payload = {
        "client_id": client_id,
        "loan_date": date.today().isoformat(),
        "loan_amount": "12000.00",
        "received_amount": "10000.00",
        "profit_amount": "2000.00",
        "notes": "EMPRESTIMO-ETAPA7-TESTE",
        "installments_config": {
            "quantity": 3,
            "first_due_date": (date.today() + timedelta(days=30)).isoformat(),
            "periodicity": "MENSAL",
        },
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def make_loan(client, admin_headers):
    def _make(client_id: int, **overrides) -> dict:
        response = client.post(
            "/api/loans", json=_loan_payload(client_id, **overrides), headers=admin_headers
        )
        assert response.status_code == 201, response.get_json()
        return response.get_json()

    return _make


def _company_payload(**overrides) -> dict:
    payload = {
        "company_name": "Minha Empresa Teste",
        "app_name": "Minha Marca",
        "company_document": "11.222.333/0001-81",
        "company_phone": "(11) 98888-7777",
        "company_email": "contato@teste.com.br",
        "company_city": "São Paulo",
        "company_state": "SP",
        "company_signature": "Atenciosamente, Minha Marca",
    }
    payload.update(overrides)
    return payload


# --- Relatório Geral unificado ---------------------------------------------


def test_general_report_includes_loans_installments_and_combined_cards(
    client, admin_headers, make_client, make_cheque, make_loan
):
    customer = make_client(operational_limit="30000.00")
    make_cheque(customer["id"])
    make_loan(customer["id"])

    response = client.get("/api/reports/summary", headers=admin_headers)
    assert response.status_code == 200
    report = response.get_json()

    assert report["cards"]["documents_count"] == 1
    assert report["cards"]["loans_count"] == 1
    assert report["cards"]["loan_amount_total"] == 12000.0
    assert report["cards"]["profit_total"] == 2000.0
    assert report["cards"]["installments_count"] == 3
    assert report["counts"]["loans"] == 1
    assert report["counts"]["installments"] == 3
    assert len(report["loans"]) == 1
    assert len(report["installments"]) == 3
    assert report["loans"][0]["code"].startswith("EMP-")
    assert report["installments"][0]["loan_code"] == report["loans"][0]["code"]

    kinds = {row["kind"]: row for row in report["by_kind"]}
    assert set(kinds) == {"CHEQUE", "BOLETO", "EMPRESTIMO"}
    assert kinds["EMPRESTIMO"]["count"] == 1
    assert kinds["EMPRESTIMO"]["loan_amount"] == 12000.0
    assert {row["status"] for row in report["by_loan_status"]} == {"ABERTA", "QUITADA", "CANCELADA"}
    assert report["by_month"]
    assert "loan_amount" in report["by_month"][0]
    assert any(row["period_loans"] == 1 for row in report["clients"])
    assert "loan_status" in report["filters"]


def test_general_report_kind_filter_isolates_documents_from_loans(
    client, admin_headers, make_client, make_cheque, make_loan
):
    customer = make_client()
    make_cheque(customer["id"])
    make_loan(customer["id"])

    loans = client.get("/api/reports/summary?kind=EMPRESTIMO", headers=admin_headers).get_json()
    assert loans["documents"] == []
    assert loans["operations"] == []
    assert loans["receipts"] == []
    assert len(loans["loans"]) == 1
    assert loans["cards"]["documents_count"] == 0

    documents = client.get("/api/reports/summary?kind=CHEQUE", headers=admin_headers).get_json()
    assert len(documents["documents"]) == 1
    assert documents["loans"] == []
    assert documents["installments"] == []
    assert documents["cards"]["loans_count"] == 0

    invalid = client.get("/api/reports/summary?kind=INVALIDO", headers=admin_headers)
    assert invalid.status_code == 422
    assert "kind" in invalid.get_json()["errors"]


def test_general_report_filters_loans_by_loan_status(client, admin_headers, make_client, make_loan):
    customer = make_client()
    make_loan(customer["id"])
    make_loan(customer["id"], status="QUITADA")

    response = client.get(
        "/api/reports/summary?kind=EMPRESTIMO&loan_status=QUITADA", headers=admin_headers
    )
    assert response.status_code == 200
    report = response.get_json()
    assert len(report["loans"]) == 1
    assert report["loans"][0]["status"] == "QUITADA"
    assert report["filters"]["loan_status"] == "QUITADA"

    invalid = client.get("/api/reports/summary?loan_status=INVALIDO", headers=admin_headers)
    assert invalid.status_code == 422
    assert "loan_status" in invalid.get_json()["errors"]


def test_saved_filters_accept_unified_kind_and_loan_status(client, admin_headers):
    response = client.post(
        "/api/reports/filters",
        json={
            "name": "Empréstimos abertos",
            "filters": {
                "kind": "EMPRESTIMO",
                "loan_status": "ABERTA",
                "status": "EM_ABERTO",
                "client_id": 1,
                "client_name": "Rótulo",
                "chave_desconhecida": "descartada",
            },
        },
        headers=admin_headers,
    )
    assert response.status_code == 201, response.get_json()
    saved = response.get_json()["item"]["filters"]
    assert saved["kind"] == "EMPRESTIMO"
    assert saved["loan_status"] == "ABERTA"
    assert saved["client_name"] == "Rótulo"
    assert "chave_desconhecida" not in saved


# --- Branding --------------------------------------------------------------


def test_branding_settings_and_logo_roundtrip(client, admin_headers, operator_headers):
    current = client.get("/api/settings/company", headers=admin_headers).get_json()["settings"]
    assert current["app_name"] == "FACTOR PRO"
    assert current["brand_logo_path"] == ""

    updated = client.put(
        "/api/settings/company", json=_company_payload(), headers=admin_headers
    )
    assert updated.status_code == 200, updated.get_json()
    assert updated.get_json()["settings"]["app_name"] == "Minha Marca"

    denied = client.put(
        "/api/settings/company", json=_company_payload(), headers=operator_headers
    )
    assert denied.status_code == 403

    upload = client.post(
        "/api/settings/company/logo",
        data={"file": (BytesIO(png_bytes()), "minha-marca.png")},
        content_type="multipart/form-data",
        headers=admin_headers,
    )
    assert upload.status_code == 201, upload.get_json()
    logo_settings = upload.get_json()["settings"]
    assert logo_settings["brand_logo_path"].endswith(".png")
    assert logo_settings["brand_logo_name"] == "minha-marca.png"

    denied_upload = client.post(
        "/api/settings/company/logo",
        data={"file": (BytesIO(png_bytes()), "negado.png")},
        content_type="multipart/form-data",
        headers=operator_headers,
    )
    assert denied_upload.status_code == 403

    public = client.get("/api/settings/brand")
    assert public.status_code == 200
    brand = public.get_json()
    assert brand["app_name"] == "Minha Marca"
    assert brand["has_logo"] is True
    assert brand["logo_url"] == "/api/settings/brand/logo"

    download = client.get("/api/settings/brand/logo")
    assert download.status_code == 200
    assert download.data.startswith(b"\x89PNG")
    assert "no-store" not in download.headers.get("Cache-Control", "").lower()

    removed = client.delete("/api/settings/company/logo", headers=admin_headers)
    assert removed.status_code == 200
    assert removed.get_json()["settings"]["brand_logo_path"] == ""
    assert client.get("/api/settings/brand").get_json()["has_logo"] is False
    assert client.get("/api/settings/brand/logo").status_code == 404


def test_exports_embed_logo_and_use_custom_brand(
    client, admin_headers, make_client, make_cheque, make_loan
):
    customer = make_client()
    make_cheque(customer["id"])
    make_loan(customer["id"])
    assert client.put("/api/settings/company", json=_company_payload(), headers=admin_headers).status_code == 200
    upload = client.post(
        "/api/settings/company/logo",
        data={"file": (BytesIO(png_bytes()), "logo.png")},
        content_type="multipart/form-data",
        headers=admin_headers,
    )
    assert upload.status_code == 201, upload.get_json()

    for url, prefix in (
        ("/api/reports/export/pdf", "relatorio-minha-marca"),
        ("/api/reports/export/xlsx", "relatorio-minha-marca"),
        ("/api/loans/report/export/pdf", "emprestimos-minha-marca"),
        ("/api/loans/report/export/xlsx", "emprestimos-minha-marca"),
    ):
        response = client.get(url, headers=admin_headers)
        assert response.status_code == 200, (url, response.get_data(as_text=True)[:200])
        assert prefix in response.headers["Content-Disposition"]
        if url.endswith("pdf"):
            assert response.data.startswith(b"%PDF")
            assert b"/Subtype /Image" in response.data
        else:
            assert response.data.startswith(b"PK")
            with ZipFile(BytesIO(response.data)) as archive:
                assert any(name.startswith("xl/media/") for name in archive.namelist())


def test_loan_messages_use_custom_company_brand(client, admin_headers, make_client, make_loan):
    customer = make_client()
    make_loan(customer["id"])
    assert client.put("/api/settings/company", json=_company_payload(), headers=admin_headers).status_code == 200

    whatsapp = client.get(
        f"/api/loans/report/whatsapp?client_id={customer['id']}", headers=admin_headers
    )
    assert whatsapp.status_code == 200
    assert "Minha Marca" in whatsapp.get_json()["item"]["message"]

    email = client.post(
        "/api/loans/report/email", json={"to": "dest@teste.com"}, headers=admin_headers
    )
    assert email.status_code == 200, email.get_json()
    assert "Minha Marca" in email.get_json()["subject"]
