"""Testes do módulo de empréstimos (Etapa 6)."""
from __future__ import annotations

from datetime import date, timedelta

import pytest


def loan_payload(client_id: int, **overrides) -> dict:
    payload = {
        "client_id": client_id,
        "loan_date": date.today().isoformat(),
        "loan_amount": "12000.00",
        "received_amount": "10000.00",
        "profit_amount": "2000.00",
        "notes": "Empréstimo de teste",
        "installments_config": {
            "quantity": 4,
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
            "/api/loans", json=loan_payload(client_id, **overrides), headers=admin_headers
        )
        assert response.status_code == 201, response.get_json()
        return response.get_json()

    return _make


def test_create_loan_generates_editable_installments_without_calculating_interest(
    client, admin_headers, make_client, make_loan
):
    customer = make_client()
    created = make_loan(customer["id"])
    item = created["item"]

    assert item["code"].startswith("EMP-")
    assert item["loan_amount"] == 12000.0
    assert item["received_amount"] == 10000.0
    assert item["profit_amount"] == 2000.0
    assert len(item["installments"]) == 4
    assert [part["number"] for part in item["installments"]] == [1, 2, 3, 4]
    assert sum(part["amount"] for part in item["installments"]) == 12000.0
    assert all(part["status"] == "EM_ABERTO" for part in item["installments"])
    assert item["client"]["name"] == customer["name"]
    assert item["has_divergence"] is False
    assert created["warnings"] == []

    dates = [part["due_date"] for part in item["installments"]]
    assert dates[0] == (date.today() + timedelta(days=30)).isoformat()
    assert dates[1] > dates[0]


def test_installments_are_editable_and_values_are_stored_as_informed(
    client, admin_headers, make_client
):
    customer = make_client()
    first = (date.today() + timedelta(days=10)).isoformat()
    second = (date.today() + timedelta(days=40)).isoformat()
    response = client.post(
        "/api/loans",
        json=loan_payload(
            customer["id"],
            installments_config=None,
            installments=[
                {"due_date": first, "amount": "7500.50"},
                {"due_date": second, "amount": "4499.50"},
            ],
        ),
        headers=admin_headers,
    )
    assert response.status_code == 201, response.get_json()
    item = response.get_json()["item"]
    assert [part["amount"] for part in item["installments"]] == [7500.5, 4499.5]
    assert [part["due_date"] for part in item["installments"]] == [first, second]


def test_divergence_and_limit_warnings_do_not_block_creation(
    client, admin_headers, make_client
):
    customer = make_client(operational_limit="1000.00")
    response = client.post(
        "/api/loans",
        json=loan_payload(
            customer["id"],
            received_amount="9000.00",
            profit_amount="1000.00",
            installments_config={
                "quantity": 2,
                "first_due_date": (date.today() + timedelta(days=15)).isoformat(),
                "periodicity": "QUINZENAL",
            },
        ),
        headers=admin_headers,
    )
    assert response.status_code == 201, response.get_json()
    body = response.get_json()
    assert body["item"]["has_divergence"] is True
    assert any("diverg" in warning.lower() for warning in body["warnings"])
    assert any("limite" in warning.lower() for warning in body["warnings"])
    assert body["item"]["limit"]["limit_exceeded"] is True


def test_loan_installments_count_towards_client_exposure(client, admin_headers, make_client, make_loan):
    customer = make_client()
    before = client.get(f"/api/clients/{customer['id']}", headers=admin_headers).get_json()["item"]
    make_loan(customer["id"])
    after = client.get(f"/api/clients/{customer['id']}", headers=admin_headers).get_json()["item"]
    assert after["summary"]["open_amount"] == pytest.approx(
        before["summary"]["open_amount"] + 12000.0
    )
    assert after["summary"]["available_limit"] == pytest.approx(
        before["summary"]["available_limit"] - 12000.0
    )
    assert after["summary"]["open_documents"] == before["summary"]["open_documents"] + 4


def test_status_change_and_soft_delete(client, admin_headers, make_client, make_loan):
    customer = make_client()
    loan = make_loan(customer["id"])["item"]
    response = client.patch(
        f"/api/loans/{loan['id']}/status", json={"status": "QUITADA"}, headers=admin_headers
    )
    assert response.status_code == 200
    assert all(part["status"] == "LIQUIDADO" for part in response.get_json()["item"]["installments"])

    deleted = client.delete(f"/api/loans/{loan['id']}", headers=admin_headers)
    assert deleted.status_code == 200
    assert client.get(f"/api/loans/{loan['id']}", headers=admin_headers).status_code == 404
    history = client.get(
        f"/api/users/audit-logs?entity=loan&action=DELETE", headers=admin_headers
    ).get_json()
    assert any(entry["entity_id"] == loan["id"] for entry in history["items"])


def test_permissions(client, admin_headers, operator_headers, viewer_headers, make_client, make_loan):
    customer = make_client()
    payload = loan_payload(customer["id"])
    assert client.post("/api/loans", json=payload, headers=viewer_headers).status_code == 403
    loan = make_loan(customer["id"])["item"]
    assert client.delete(f"/api/loans/{loan['id']}", headers=operator_headers).status_code == 403
    assert client.get("/api/loans", headers=viewer_headers).status_code == 200


def test_filters_totals_and_duplicata(client, admin_headers, make_client, make_loan):
    customer = make_client()
    make_loan(customer["id"])
    listing = client.get(
        f"/api/loans?client_id={customer['id']}&status=ABERTA", headers=admin_headers
    ).get_json()
    assert listing["meta"]["total"] == 1
    assert listing["totals"]["loan_amount"] == 12000.0
    assert listing["totals"]["installments"] == 4

    duplicata = client.get(
        f"/api/loans/{listing['items'][0]['id']}/duplicata", headers=admin_headers
    ).get_json()
    assert duplicata["item"]["client"]["document"] == customer["document"]
    assert "company_name" in duplicata["company"]
    assert len(duplicata["item"]["installments"]) == 4


def test_report_summary_exports_whatsapp_and_email(
    client, admin_headers, make_client, make_loan
):
    customer = make_client(whatsapp="11988887777", email="cliente@test.com")
    make_loan(customer["id"])
    summary = client.get("/api/loans/report/summary", headers=admin_headers).get_json()
    assert summary["cards"]["loans_count"] == 1
    assert summary["cards"]["loan_amount_total"] == 12000.0
    assert summary["cards"]["profit_total"] == 2000.0
    assert summary["cards"]["installments_count"] == 4
    assert len(summary["by_month"]) == 1
    assert summary["clients"][0]["name"] == customer["name"]

    pdf = client.get("/api/loans/report/export/pdf", headers=admin_headers)
    assert pdf.status_code == 200
    assert pdf.data.startswith(b"%PDF")
    xlsx = client.get("/api/loans/report/export/xlsx", headers=admin_headers)
    assert xlsx.status_code == 200
    assert xlsx.data.startswith(b"PK")
    audits = client.get(
        "/api/users/audit-logs?entity=loan_report&action=EXPORT", headers=admin_headers
    ).get_json()
    assert len(audits["items"]) >= 2

    wa = client.get(
        f"/api/loans/report/whatsapp?client_id={customer['id']}", headers=admin_headers
    ).get_json()["item"]
    assert "11988887777" in wa["url"]
    assert "Empréstimo" not in wa["message"] or customer["name"] in wa["message"]

    mail = client.post(
        "/api/loans/report/email",
        json={"to": "destino@test.com"},
        headers=admin_headers,
    )
    assert mail.status_code == 200
    assert mail.get_json()["email_sent"] is False
    assert "12.000,00" in mail.get_json()["preview"]


def test_client_deletion_is_blocked_while_loans_exist(client, admin_headers, make_client, make_loan):
    customer = make_client()
    make_loan(customer["id"])
    response = client.delete(f"/api/clients/{customer['id']}", headers=admin_headers)
    assert response.status_code == 422
