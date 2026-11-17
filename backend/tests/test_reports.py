"""Reports, exports (PDF/XLSX) and WhatsApp message rules (Etapa 3)."""
from __future__ import annotations

from datetime import date, timedelta


def _operation(client, headers, client_id, document, **overrides):
    payload = {
        "client_id": client_id,
        "operation_date": date.today().isoformat(),
        "description": "Borderô do relatório",
        "documents": [{"kind": document["kind"], "id": document["id"]}],
    }
    payload.update(overrides)
    response = client.post("/api/operations", json=payload, headers=headers)
    assert response.status_code == 201, response.get_json()
    return response.get_json()["item"]


def _receipt(client, headers, document, amount, **overrides):
    payload = {
        "document_kind": document["kind"],
        "document_id": document["id"],
        "receipt_date": date.today().isoformat(),
        "amount": amount,
    }
    payload.update(overrides)
    response = client.post("/api/receipts", json=payload, headers=headers)
    assert response.status_code == 201, response.get_json()
    return response.get_json()["item"]


def test_report_summary_aggregates_real_documents(
    client, admin_headers, make_client, make_cheque, make_boleto
):
    client_item = make_client(operational_limit="30000.00")
    cheque = make_cheque(client_item["id"])["item"]
    boleto = make_boleto(client_item["id"])["item"]

    response = client.get("/api/reports/summary", headers=admin_headers)
    assert response.status_code == 200, response.get_json()
    data = response.get_json()

    cards = data["cards"]
    assert cards["documents_count"] == 2
    assert cards["nominal_total"] == 15000.0
    assert cards["costs_total"] == 750.0
    assert cards["net_total"] == 14250.0
    assert cards["open_total"] == 14250.0
    assert cards["overdue_total"] == 0.0
    assert cards["divergences_count"] == 0
    assert cards["operations_count"] == 0
    assert cards["receipts_count"] == 0

    kinds = {item["kind"]: item for item in data["by_kind"]}
    assert kinds["CHEQUE"]["count"] == 1
    assert kinds["CHEQUE"]["nominal"] == 10000.0
    assert kinds["BOLETO"]["net"] == 4750.0

    statuses = {item["status"]: item for item in data["by_status"]}
    assert statuses["EM_ABERTO"]["count"] == 2
    assert statuses["LIQUIDADO"]["count"] == 0

    # Client row derives the available limit from the client's informed limit.
    client_row = next(row for row in data["clients"] if row["id"] == client_item["id"])
    assert client_row["operational_limit"] == 30000.0
    assert client_row["open_amount"] == 14250.0
    assert client_row["available_limit"] == 15750.0
    assert client_row["period_documents"] == 2

    # Documents carry the informed values exactly.
    by_code = {item["code"]: item for item in data["documents"]}
    assert by_code[cheque["code"]]["nominal_amount"] == 10000.0
    assert by_code[cheque["code"]]["net_amount"] == 9500.0
    assert by_code[boleto["code"]]["net_amount"] == 4750.0


def test_report_filters_by_period_kind_status_and_client(
    client, admin_headers, make_client, make_cheque, make_boleto
):
    first = make_client(name="Cliente Relatório Alfa")
    second = make_client(name="Cliente Relatório Beta", document="529.982.247-25")
    cheque = make_cheque(
        first["id"],
        operation_date="2026-01-10",
        due_date="2026-02-10",
        issue_date="2026-01-01",
    )["item"]
    make_boleto(
        second["id"],
        operation_date="2026-06-10",
        due_date="2026-07-10",
        issue_date="2026-06-01",
    )

    by_period = client.get(
        "/api/reports/summary?date_from=2026-01-01&date_to=2026-03-31", headers=admin_headers
    ).get_json()
    assert by_period["cards"]["documents_count"] == 1
    assert by_period["documents"][0]["code"] == cheque["code"]

    by_kind = client.get("/api/reports/summary?kind=BOLETO", headers=admin_headers).get_json()
    assert by_kind["cards"]["documents_count"] == 1
    assert by_kind["documents"][0]["kind"] == "BOLETO"

    by_client = client.get(f"/api/reports/summary?client_id={first['id']}", headers=admin_headers).get_json()
    assert by_client["cards"]["documents_count"] == 1
    assert all(item["client_id"] == first["id"] for item in by_client["documents"])

    by_search = client.get("/api/reports/summary?search=Beta", headers=admin_headers).get_json()
    assert by_search["cards"]["documents_count"] == 1
    assert by_search["documents"][0]["kind"] == "BOLETO"

    by_status = client.get("/api/reports/summary?status=LIQUIDADO", headers=admin_headers).get_json()
    assert by_status["cards"]["documents_count"] == 0

    invalid = client.get(
        "/api/reports/summary?date_from=2026-05-01&date_to=2026-01-01", headers=admin_headers
    )
    assert invalid.status_code == 422
    assert "date_to" in invalid.get_json()["errors"]


def test_report_includes_operations_and_manual_receipts(
    client, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    operation = _operation(client, admin_headers, client_item["id"], cheque)
    receipt = _receipt(client, admin_headers, cheque, "1000.00")

    data = client.get("/api/reports/summary", headers=admin_headers).get_json()
    assert data["cards"]["operations_count"] == 1
    assert data["cards"]["operations_net"] == 9500.0
    assert data["cards"]["receipts_count"] == 1
    assert data["cards"]["receipts_total"] == 1000.0
    assert data["cards"]["open_total"] == 9500.0  # partial receipt keeps the title open
    assert data["operations"][0]["id"] == operation["id"]
    assert data["receipts"][0]["code"] == receipt["code"]
    assert data["receipts"][0]["amount"] == 1000.0

    # A full manual receipt settles the title and removes it from the open total.
    _receipt(client, admin_headers, cheque, "8500.00")
    full = client.get("/api/reports/summary", headers=admin_headers).get_json()
    assert full["cards"]["open_total"] == 0.0
    assert full["cards"]["settled_total"] == 9500.0


def test_report_overdue_filter_only_returns_pending_past_due(
    client, admin_headers, make_client, make_cheque, make_boleto
):
    client_item = make_client()
    past = (date.today() - timedelta(days=10)).isoformat()
    future = (date.today() + timedelta(days=10)).isoformat()
    make_cheque(
        client_item["id"],
        due_date=past,
        issue_date=(date.today() - timedelta(days=20)).isoformat(),
    )["item"]
    make_boleto(client_item["id"], due_date=future)["item"]

    data = client.get("/api/reports/summary?overdue=1", headers=admin_headers).get_json()
    assert data["cards"]["documents_count"] == 1
    assert data["documents"][0]["kind"] == "CHEQUE"
    assert data["documents"][0]["is_overdue"] is True


def test_soft_deleted_documents_do_not_appear_in_reports(
    client, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    assert client.delete(f"/api/cheques/{cheque['id']}", headers=admin_headers).status_code == 200

    data = client.get("/api/reports/summary", headers=admin_headers).get_json()
    assert data["cards"]["documents_count"] == 0
    assert data["documents"] == []


def test_whatsapp_message_uses_pending_titles_and_client_phone(
    client, admin_headers, make_client, make_cheque
):
    client_item = make_client(
        name="Maria Souza",
        phone="(11) 98888-7777",
        whatsapp="(11) 97777-6666",
    )
    cheque = make_cheque(client_item["id"])["item"]

    response = client.get(
        f"/api/reports/whatsapp?client_id={client_item['id']}", headers=admin_headers
    )
    assert response.status_code == 200, response.get_json()
    item = response.get_json()["item"]
    assert item["client"]["name"] == "Maria Souza"
    assert "Maria" in item["message"]
    assert cheque["code"] in item["message"]
    assert "R$ 9.500,00" in item["message"]
    assert item["total"] == 9500.0
    assert item["phone"] == "5511977776666"
    assert item["url"].startswith("https://wa.me/5511977776666?text=")

    missing = client.get("/api/reports/whatsapp?client_id=999999", headers=admin_headers)
    assert missing.status_code == 422


def test_report_pdf_and_xlsx_exports_are_audited(
    client, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]

    pdf = client.get("/api/reports/export/pdf", headers=admin_headers)
    assert pdf.status_code == 200, pdf.get_json()
    assert pdf.data.startswith(b"%PDF")
    assert "attachment" in pdf.headers["Content-Disposition"]
    assert ".pdf" in pdf.headers["Content-Disposition"]

    xlsx = client.get("/api/reports/export/xlsx", headers=admin_headers)
    assert xlsx.status_code == 200, xlsx.get_json()
    assert xlsx.data.startswith(b"PK")
    assert "spreadsheetml" in xlsx.headers["Content-Type"]

    logs = client.get(
        "/api/users/audit-logs?entity=report&action=EXPORT", headers=admin_headers
    ).get_json()
    assert logs["meta"]["total"] >= 2
    descriptions = " ".join(item["description"] for item in logs["items"])
    assert "PDF" in descriptions
    assert "XLSX" in descriptions

    # Filters are honoured by the export as well.
    filtered = client.get(
        f"/api/reports/export/xlsx?client_id={client_item['id']}", headers=admin_headers
    )
    assert filtered.status_code == 200


def test_viewer_can_read_and_export_reports(
    client, viewer_headers, make_client, make_cheque
):
    client_item = make_client()
    make_cheque(client_item["id"])
    assert client.get("/api/reports/summary", headers=viewer_headers).status_code == 200
    assert client.get("/api/reports/export/pdf", headers=viewer_headers).status_code == 200
    assert client.get("/api/reports/export/xlsx", headers=viewer_headers).status_code == 200


def test_dashboard_exposes_monthly_movement_and_top_clients(
    client, admin_headers, make_client, make_cheque
):
    client_item = make_client()
    cheque = make_cheque(client_item["id"])["item"]
    _receipt(client, admin_headers, cheque, "1000.00")

    data = client.get("/api/dashboard/summary", headers=admin_headers).get_json()
    assert data["by_month"]
    assert any(item["documents"] for item in data["by_month"])
    assert any(item["receipts"] for item in data["by_month"])
    assert data["top_clients"]
    assert data["top_clients"][0]["id"] == client_item["id"]
    assert data["top_clients"][0]["open_amount"] == 9500.0
