"""Dashboard aggregation tests."""
from __future__ import annotations

from datetime import date, timedelta


def test_dashboard_requires_authentication(client):
    assert client.get("/api/dashboard/summary").status_code == 401


def test_dashboard_cards_are_derived_from_documents(
    client, admin_headers, make_client, make_cheque, make_boleto
):
    client_item = make_client()
    make_cheque(client_item["id"])
    make_boleto(client_item["id"])

    body = client.get("/api/dashboard/summary", headers=admin_headers).get_json()
    cards = body["cards"]
    assert cards["clients_total"] == 1
    assert cards["operations_total"] == 2
    assert cards["cheques_nominal"] == 10000.0
    assert cards["boletos_nominal"] == 5000.0
    assert cards["nominal_total"] == 15000.0
    assert cards["paid_total"] == 14250.0
    assert cards["gains_registered"] == 750.0
    assert cards["open_total"] == 14250.0
    assert cards["overdue_count"] == 0
    assert body["by_type"][0]["count"] == 1
    assert body["by_type"][1]["count"] == 1


def test_dashboard_client_filter(client, admin_headers, make_client, make_cheque):
    first = make_client(name="Cliente A")
    second = make_client(name="Cliente B", document="529.982.247-25")
    make_cheque(first["id"])
    make_cheque(second["id"], nominal_amount="3000.00", discount_amount="150.00", net_amount="2850.00")

    body = client.get(
        f"/api/dashboard/summary?client_id={first['id']}", headers=admin_headers
    ).get_json()
    assert body["cards"]["operations_total"] == 1
    assert body["cards"]["nominal_total"] == 10000.0


def test_dashboard_date_filter(client, admin_headers, make_client, make_cheque):
    item = make_client()
    make_cheque(item["id"], operation_date=(date.today() - timedelta(days=40)).isoformat())

    body = client.get(
        f"/api/dashboard/summary?date_from={date.today().isoformat()}", headers=admin_headers
    ).get_json()
    assert body["cards"]["operations_total"] == 0


def test_dashboard_overdue_alert(client, admin_headers, make_client, make_cheque):
    item = make_client()
    make_cheque(
        item["id"],
        due_date=(date.today() - timedelta(days=1)).isoformat(),
        operation_date=(date.today() - timedelta(days=30)).isoformat(),
    )
    body = client.get("/api/dashboard/summary", headers=admin_headers).get_json()
    assert body["cards"]["overdue_count"] == 1
    assert body["cards"]["overdue_total"] == 9500.0
    assert len(body["overdue_documents"]) == 1
