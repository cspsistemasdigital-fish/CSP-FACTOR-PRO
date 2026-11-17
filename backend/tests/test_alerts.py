"""Delinquency block, overdue alerts and startup notification data."""
from __future__ import annotations

from datetime import date, timedelta

from conftest import cheque_payload


def _overdue_cheque_fields() -> dict:
    payload = cheque_payload(0)
    payload.pop("client_id")
    payload.update(
        issue_date=(date.today() - timedelta(days=40)).isoformat(),
        due_date=(date.today() - timedelta(days=10)).isoformat(),
        operation_date=(date.today() - timedelta(days=40)).isoformat(),
    )
    return payload


def test_alerts_are_empty_without_overdue_documents(client, admin_headers):
    response = client.get("/api/alerts", headers=admin_headers)
    assert response.status_code == 200
    data = response.get_json()
    assert data["items"] == []
    assert data["client_count"] == 0
    assert data["total_amount"] == 0


def test_overdue_alert_reports_client_amount_and_message(client, admin_headers, make_client, make_cheque):
    item = make_client(name="Inadimplente Alertado", document="529.982.247-25")
    make_cheque(item["id"], **_overdue_cheque_fields())

    data = client.get("/api/alerts", headers=admin_headers).get_json()
    assert data["client_count"] == 1
    assert data["document_count"] == 1
    assert data["total_amount"] == 9500.0
    alert = data["items"][0]
    assert alert["client_id"] == item["id"]
    assert alert["name"] == "Inadimplente Alertado"
    assert alert["overdue_documents"] == 1
    assert "em atraso" in alert["message"]


def test_block_requires_reason_and_is_audited(client, admin_headers, make_client):
    item = make_client(name="Cliente para Bloquear", document="529.982.247-25")
    url = f"/api/clients/{item['id']}/block"

    invalid = client.patch(url, json={"blocked": True}, headers=admin_headers)
    assert invalid.status_code == 422
    assert "reason" in invalid.get_json()["errors"]

    blocked = client.patch(
        url,
        json={"blocked": True, "reason": "Títulos vencidos em atraso"},
        headers=admin_headers,
    )
    assert blocked.status_code == 200, blocked.get_json()
    assert blocked.get_json()["item"]["is_blocked"] is True
    assert blocked.get_json()["item"]["blocked_reason"] == "Títulos vencidos em atraso"

    logs = client.get("/api/users/audit-logs?entity=client", headers=admin_headers).get_json()
    assert any(log["action"] == "STATUS_CHANGE" and "bloqueado" in log["description"] for log in logs["items"])

    unblocked = client.patch(url, json={"blocked": False}, headers=admin_headers)
    assert unblocked.status_code == 200
    assert unblocked.get_json()["item"]["is_blocked"] is False


def test_blocked_client_cannot_receive_new_documents_or_operations(
    client, admin_headers, make_client, make_cheque
):
    item = make_client(name="Bloqueado Teste", document="529.982.247-25")
    existing = make_cheque(item["id"])
    client.patch(
        f"/api/clients/{item['id']}/block",
        json={"blocked": True, "reason": "Inadimplência confirmada"},
        headers=admin_headers,
    )

    cheque = client.post(
        "/api/cheques", json=cheque_payload(item["id"], number="000999"), headers=admin_headers
    )
    assert cheque.status_code == 422
    assert "bloqueado" in cheque.get_json()["errors"]["client_id"]

    operation = client.post(
        "/api/operations",
        json={
            "client_id": item["id"],
            "operation_date": date.today().isoformat(),
            "documents": [{"kind": "CHEQUE", "id": existing["item"]["id"]}],
        },
        headers=admin_headers,
    )
    assert operation.status_code == 422
    assert "bloqueado" in operation.get_json()["errors"]["client_id"]

    # Editing an existing document remains allowed so arrears can be corrected.
    payload = cheque_payload(item["id"], number="000123", net_amount="9000.00")
    edit = client.put(f"/api/cheques/{existing['item']['id']}", json=payload, headers=admin_headers)
    assert edit.status_code == 200, edit.get_json()


def test_blocked_filter_and_permissions(client, admin_headers, viewer_headers, make_client):
    item = make_client(name="Filtrado Bloqueado", document="529.982.247-25")
    client.patch(
        f"/api/clients/{item['id']}/block",
        json={"blocked": True, "reason": "Atraso reiterado"},
        headers=admin_headers,
    )
    data = client.get("/api/clients?blocked=1", headers=admin_headers).get_json()
    assert data["totals"]["blocked"] == 1
    assert all(row["is_blocked"] for row in data["items"])

    denied = client.patch(
        f"/api/clients/{item['id']}/block",
        json={"blocked": False},
        headers=viewer_headers,
    )
    assert denied.status_code == 403
