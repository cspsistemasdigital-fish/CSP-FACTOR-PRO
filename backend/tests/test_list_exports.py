"""Etapa 8: botão "Exportar Excel" em todas as listagens (dados salvos)."""
from __future__ import annotations

from datetime import date, timedelta
from io import BytesIO

from openpyxl import load_workbook

from conftest import png_bytes


def _workbook(response):
    assert response.status_code == 200, response.get_json()
    assert response.mimetype == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert response.data[:2] == b"PK"
    return load_workbook(BytesIO(response.data))


def test_export_clients_respects_filters_and_uses_brand(
    client, admin_headers, make_client
):
    keep = make_client(name="Cliente Planilha Mantido")

    response = client.get("/api/export/clients/xlsx?search=Planilha%20Mantido", headers=admin_headers)
    wb = _workbook(response)
    ws = wb.active
    assert ws["A1"].value == "FACTOR PRO"
    assert ws["A4"].value == "Código"
    rows = list(ws.iter_rows(min_row=5, values_only=True))
    assert len(rows) == 1
    assert rows[0][1] == keep["name"]
    assert ws.freeze_panes == "A5"

    empty = client.get("/api/export/clients/xlsx?search=NAO-EXISTE", headers=admin_headers)
    assert list(_workbook(empty).active.iter_rows(min_row=5, values_only=True)) == []


def test_export_all_domain_lists(client, admin_headers, make_client, make_cheque, make_boleto):
    owner = make_client()
    cheque = make_cheque(owner["id"], identifier="CHQ-EXPORT")["item"]
    boleto = make_boleto(owner["id"], identifier="BOL-EXPORT")["item"]

    operation = client.post(
        "/api/operations",
        json={
            "client_id": owner["id"],
            "operation_date": date.today().isoformat(),
            "description": "OPERAÇÃO-EXPORT",
            "documents": [{"kind": "CHEQUE", "id": cheque["id"]}],
        },
        headers=admin_headers,
    ).get_json()["item"]

    receipt = client.post(
        "/api/receipts",
        json={
            "document_kind": "BOLETO",
            "document_id": boleto["id"],
            "receipt_date": date.today().isoformat(),
            "amount": "100.00",
            "notes": "RECIBO-EXPORT",
        },
        headers=admin_headers,
    ).get_json()["item"]

    loan = client.post(
        "/api/loans",
        json={
            "client_id": owner["id"],
            "loan_date": date.today().isoformat(),
            "loan_amount": "12000.00",
            "received_amount": "10000.00",
            "profit_amount": "2000.00",
            "installments_config": {
                "quantity": 2,
                "first_due_date": (date.today() + timedelta(days=30)).isoformat(),
                "periodicity": "MENSAL",
            },
        },
        headers=admin_headers,
    ).get_json()["item"]

    operation = client.put(
        f"/api/operations/{operation['id']}",
        json={
            "client_id": owner["id"],
            "operation_date": date.today().isoformat(),
            "description": "OPERAÇÃO-EXPORT",
            "documents": [{"kind": "CHEQUE", "id": cheque["id"]}],
            "loan_ids": [loan["id"]],
        },
        headers=admin_headers,
    ).get_json()["item"]

    expectations = {
        "cheques": cheque["code"],
        "boletos": boleto["code"],
        "operations": operation["code"],
        "receipts": receipt["code"],
        "loans": loan["code"],
    }
    for resource, code in expectations.items():
        wb = _workbook(client.get(f"/api/export/{resource}/xlsx", headers=admin_headers))
        values = list(wb.active.iter_rows(min_row=5, values_only=True))
        assert any(row[0] == code for row in values), (resource, values)
        assert wb.active.freeze_panes == "A5"

    operation_sheet = _workbook(
        client.get("/api/export/operations/xlsx", headers=admin_headers)
    ).active
    operation_row = next(
        row for row in operation_sheet.iter_rows(min_row=5, values_only=True)
        if row[0] == operation["code"]
    )
    assert operation_row[9] == 1
    assert operation_row[10] == 12000.0
    assert operation_row[11] == 10000.0
    assert operation_row[12] == 2000.0

    # Identifiers typed in the forms are exported as well.
    for resource, identifier in (("cheques", "CHQ-EXPORT"), ("boletos", "BOL-EXPORT")):
        values = list(
            _workbook(client.get(f"/api/export/{resource}/xlsx", headers=admin_headers))
            .active.iter_rows(min_row=5, values_only=True)
        )
        assert any(row[1] == identifier for row in values)

    # Filters are applied to the whole export, not just to the first page.
    filtered = client.get("/api/export/cheques/xlsx?search=NAO-EXISTE", headers=admin_headers)
    assert list(_workbook(filtered).active.iter_rows(min_row=5, values_only=True)) == []


def test_export_records_audit_and_blocks_non_admin_resources(
    client, admin_headers, operator_headers, make_client
):
    make_client()
    response = client.get("/api/export/clients/xlsx", headers=admin_headers)
    _workbook(response)
    assert "factor-pro" in response.headers["Content-Disposition"].lower()

    logs = client.get("/api/users/audit-logs?entity=clients_list", headers=admin_headers).get_json()["items"]
    assert any(entry["action"] == "EXPORT" for entry in logs)

    for resource in ("users", "audit"):
        assert client.get(f"/api/export/{resource}/xlsx", headers=operator_headers).status_code == 403
        assert _workbook(client.get(f"/api/export/{resource}/xlsx", headers=admin_headers))

    assert client.get("/api/export/desconhecido/xlsx", headers=admin_headers).status_code == 404
