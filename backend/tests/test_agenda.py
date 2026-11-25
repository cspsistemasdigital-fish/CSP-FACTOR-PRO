"""Shared agenda event CRUD, permissions and validation."""
from __future__ import annotations

from app.extensions import db
from app.models import AgendaEvent, AuditLog


def _event_payload(**overrides):
    payload = {
        "title": "Reunião de alinhamento",
        "start_at": "2026-11-25T09:00",
        "end_at": "2026-11-25T10:00",
        "location": "Sala de reuniões",
        "description": "Revisar compromissos da semana.",
        "color": "blue",
    }
    payload.update(overrides)
    return payload


def test_agenda_is_shared_and_crud_is_audited(
    app, client, operator_headers, viewer_headers, admin_headers
):
    created = client.post("/api/agenda", json=_event_payload(), headers=operator_headers)
    assert created.status_code == 201
    item = created.get_json()["item"]
    assert item["title"] == "Reunião de alinhamento"
    assert item["created_by"] == "Operador Teste"

    visible_to_viewer = client.get(
        "/api/agenda?start=2026-11-01&end=2026-12-01", headers=viewer_headers
    )
    assert [event["id"] for event in visible_to_viewer.get_json()["items"]] == [item["id"]]

    updated = client.put(
        f"/api/agenda/{item['id']}",
        json=_event_payload(title="Reunião atualizada"),
        headers=operator_headers,
    )
    assert updated.status_code == 200
    assert updated.get_json()["item"]["title"] == "Reunião atualizada"

    forbidden_delete = client.delete(f"/api/agenda/{item['id']}", headers=operator_headers)
    assert forbidden_delete.status_code == 403
    removed = client.delete(f"/api/agenda/{item['id']}", headers=admin_headers)
    assert removed.status_code == 200
    assert client.get(
        "/api/agenda?start=2026-11-01&end=2026-12-01", headers=viewer_headers
    ).get_json()["items"] == []

    with app.app_context():
        event = db.session.get(AgendaEvent, item["id"])
        assert event.is_deleted
        actions = [
            row.action
            for row in AuditLog.query.filter_by(entity="agenda_event", entity_id=item["id"])
            .order_by(AuditLog.id)
            .all()
        ]
        assert actions == ["CREATE", "UPDATE", "DELETE"]


def test_agenda_requires_write_role_for_create_and_update(
    client, viewer_headers, operator_headers
):
    denied_create = client.post(
        "/api/agenda", json=_event_payload(), headers=viewer_headers
    )
    assert denied_create.status_code == 403

    created = client.post(
        "/api/agenda", json=_event_payload(), headers=operator_headers
    )
    event_id = created.get_json()["item"]["id"]
    denied_update = client.put(
        f"/api/agenda/{event_id}",
        json=_event_payload(title="Sem permissão"),
        headers=viewer_headers,
    )
    assert denied_update.status_code == 403


def test_agenda_validates_required_fields_and_time_order(client, admin_headers):
    response = client.post(
        "/api/agenda",
        json=_event_payload(title="", end_at="2026-11-25T09:00"),
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "title" in response.get_json()["errors"]
    assert "end_at" in response.get_json()["errors"]

    invalid_color = client.post(
        "/api/agenda", json=_event_payload(color="custom"), headers=admin_headers
    )
    assert invalid_color.status_code == 422
    assert "color" in invalid_color.get_json()["errors"]


def test_agenda_date_range_excludes_events_at_end_boundary(
    client, admin_headers, operator_headers
):
    inside = client.post(
        "/api/agenda", json=_event_payload(), headers=operator_headers
    ).get_json()["item"]
    outside = client.post(
        "/api/agenda",
        json=_event_payload(
            title="Próximo mês",
            start_at="2026-12-01T00:00",
            end_at="2026-12-01T01:00",
        ),
        headers=operator_headers,
    ).get_json()["item"]

    response = client.get(
        "/api/agenda?start=2026-11-01&end=2026-12-01", headers=admin_headers
    )
    assert [event["id"] for event in response.get_json()["items"]] == [inside["id"]]
    assert outside["id"] != inside["id"]


def test_agenda_requires_a_bounded_date_range(client, admin_headers):
    response = client.get("/api/agenda", headers=admin_headers)
    assert response.status_code == 422
    assert "start" in response.get_json()["errors"]
