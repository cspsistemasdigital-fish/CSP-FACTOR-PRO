"""Operation (borderô) business rules.

An operation groups cheques and/or boletos of a single client. The system never
calculates interest, discount or fees: the operation totals are always DERIVED
from the documents the user linked, and every value is the one informed on the
document itself.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import or_

from ..extensions import db
from ..models import (
    AuditAction,
    AuditLog,
    Boleto,
    Cheque,
    Client,
    ClientStatus,
    DocumentKind,
    DocumentStatus,
    Loan,
    LoanStatus,
    Operation,
    OperationStatus,
    Role,
)
from ..models.operation import document_costs, document_nominal
from ..utils.validators import (
    ValidationError,
    clean_text,
    parse_choice,
    parse_date,
    parse_int,
)
from .audit import diff_changes, log_action

MAX_DOCUMENTS = 500


def _resolve_client(payload: dict, errors: dict, *, require_active: bool) -> Client | None:
    try:
        client_id = parse_int(payload.get("client_id"), "client_id", required=True, minimum=1)
    except ValidationError as exc:
        errors.update(exc.errors)
        return None
    client = db.session.get(Client, client_id)
    if not client or client.is_deleted:
        errors["client_id"] = "Cliente não encontrado."
        return None
    if require_active and client.status != ClientStatus.ACTIVE:
        errors["client_id"] = (
            f"O cliente {client.code} está inativo e não pode receber novas operações."
        )
        return None
    if require_active and getattr(client, "is_blocked", False):
        reason = client.blocked_reason or "títulos em atraso"
        errors["client_id"] = (
            f"O cliente {client.code} está bloqueado por inadimplência ({reason}) "
            "e não pode receber novas operações."
        )
        return None
    return client


def _parse_document_keys(raw) -> list[tuple[str, int]]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError({"documents": "Lista de documentos inválida."})
    parsed: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValidationError({"documents": "Cada item deve informar tipo e identificador."})
        kind = entry.get("kind") or entry.get("document_kind")
        raw_id = entry.get("id") if entry.get("id") is not None else entry.get("document_id")
        if kind not in DocumentKind.ALL:
            raise ValidationError({"documents": "Tipo de documento inválido."})
        try:
            document_id = int(raw_id)
        except (TypeError, ValueError):
            raise ValidationError({"documents": "Identificador de documento inválido."})
        key = (kind, document_id)
        if key in seen:
            continue
        seen.add(key)
        parsed.append(key)
    if len(parsed) > MAX_DOCUMENTS:
        raise ValidationError({"documents": f"Uma operação pode reunir no máximo {MAX_DOCUMENTS} documentos."})
    return parsed


def _parse_loan_ids(raw) -> list[int]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise ValidationError({"loan_ids": "Lista de empréstimos inválida."})
    parsed = []
    seen = set()
    for raw_id in raw:
        try:
            loan_id = int(raw_id)
        except (TypeError, ValueError):
            raise ValidationError({"loan_ids": "Identificador de empréstimo inválido."})
        if loan_id < 1:
            raise ValidationError({"loan_ids": "Identificador de empréstimo inválido."})
        if loan_id not in seen:
            seen.add(loan_id)
            parsed.append(loan_id)
    if len(parsed) > MAX_DOCUMENTS:
        raise ValidationError({"loan_ids": f"Uma operação pode reunir no máximo {MAX_DOCUMENTS} empréstimos."})
    return parsed


def _load_documents(
    keys: list[tuple[str, int]], client_id: int, errors: dict, operation: Operation | None
) -> list:
    documents = []
    for kind, document_id in keys:
        model = Cheque if kind == DocumentKind.CHEQUE else Boleto
        document = db.session.get(model, document_id)
        if not document or document.is_deleted:
            errors["documents"] = f"{DocumentKind.LABELS[kind]} #{document_id} não encontrado."
            continue
        if document.client_id != client_id:
            errors["documents"] = (
                f"O documento {document.code} pertence a outro cliente. "
                "Uma operação reúne documentos de um único cliente."
            )
            continue
        if document.operation_id and (operation is None or document.operation_id != operation.id):
            errors["documents"] = f"O documento {document.code} já pertence a outra operação."
            continue
        documents.append(document)
    return documents


def _load_loans(
    loan_ids: list[int], client_id: int, errors: dict, operation: Operation | None
) -> list[Loan]:
    loans = []
    for loan_id in loan_ids:
        loan = db.session.get(Loan, loan_id)
        if not loan or loan.is_deleted:
            errors["loan_ids"] = f"Empréstimo #{loan_id} não encontrado."
            continue
        if loan.client_id != client_id:
            errors["loan_ids"] = (
                f"O empréstimo {loan.code} pertence a outro cliente. "
                "Uma operação reúne itens de um único cliente."
            )
            continue
        if loan.status == LoanStatus.CANCELLED:
            errors["loan_ids"] = f"O empréstimo {loan.code} está cancelado."
            continue
        if loan.operation_id and (operation is None or loan.operation_id != operation.id):
            errors["loan_ids"] = f"O empréstimo {loan.code} já pertence a outra operação."
            continue
        loans.append(loan)
    return loans


def _set_operation_link(document, operation: Operation | None, user_id: int | None) -> None:
    document.operation = operation
    document.updated_by_id = user_id


def _set_loan_link(loan: Loan, operation: Operation | None, user_id: int | None) -> None:
    loan.operation = operation
    loan.updated_by_id = user_id


def build_operation_payload(payload: dict, existing: Operation | None = None) -> dict:
    errors: dict[str, str] = {}
    client = _resolve_client(payload, errors, require_active=existing is None)

    try:
        keys = _parse_document_keys(payload.get("documents"))
    except ValidationError as exc:
        errors.update(exc.errors)
        keys = []

    try:
        loan_ids = _parse_loan_ids(payload.get("loan_ids"))
    except ValidationError as exc:
        errors.update(exc.errors)
        loan_ids = []

    try:
        operation_date = parse_date(
            payload.get("operation_date") or date.today(),
            "operation_date",
            label="a data da operação",
        )
    except ValidationError as exc:
        errors.update(exc.errors)
        operation_date = None

    status = parse_choice(
        payload.get("status") or OperationStatus.OPEN,
        OperationStatus.ALL,
        "status",
        required=False,
        default=OperationStatus.OPEN,
    )

    documents: list = []
    loans: list[Loan] = []
    if client is not None and "documents" not in errors:
        documents = _load_documents(keys, client.id, errors, existing)
    if client is not None and "loan_ids" not in errors:
        loans = _load_loans(loan_ids, client.id, errors, existing)

    if errors:
        raise ValidationError(errors)

    return {
        "client_id": client.id,
        "operation_date": operation_date,
        "description": clean_text(payload.get("description"), 180),
        "notes": clean_text(payload.get("notes"), 2000),
        "status": status or OperationStatus.OPEN,
        "documents": documents,
        "loans": loans,
    }


def create_operation(payload: dict, user) -> Operation:
    data = build_operation_payload(payload)
    documents = data.pop("documents")
    loans = data.pop("loans")
    operation = Operation(code=f"TMP-{uuid4().hex[:10]}", created_by_id=user.id, **data)
    db.session.add(operation)
    db.session.flush()
    operation.code = f"OPR-{operation.id:05d}"
    for document in documents:
        _set_operation_link(document, operation, user.id)
    for loan in loans:
        _set_loan_link(loan, operation, user.id)
    db.session.flush()
    log_action(
        AuditAction.CREATE,
        "operation",
        operation.id,
        f"Operação {operation.code} criada com {len(documents)} documento(s)",
        changes={
            "client_id": operation.client_id,
            "documents": [document.code for document in documents],
            "loans": [loan.code for loan in loans],
            "totals": operation.totals(),
        },
    )
    db.session.commit()
    return operation


def update_operation(operation: Operation, payload: dict, user) -> Operation:
    data = build_operation_payload(payload, existing=operation)
    documents = data.pop("documents")
    loans = data.pop("loans")
    before = operation.to_dict(include_items=False)
    wanted_ids = {document.id for document in documents}
    wanted_loan_ids = {loan.id for loan in loans}

    for document in list(operation.active_documents()):
        if document.id not in wanted_ids:
            _set_operation_link(document, None, user.id)
    for loan in list(operation.active_loans()):
        if loan.id not in wanted_loan_ids:
            _set_loan_link(loan, None, user.id)
    for document in documents:
        _set_operation_link(document, operation, user.id)
    for loan in loans:
        _set_loan_link(loan, operation, user.id)

    for field, value in data.items():
        setattr(operation, field, value)
    operation.updated_by_id = user.id
    db.session.flush()
    db.session.refresh(operation)
    after = operation.to_dict(include_items=False)
    changes = diff_changes(before, after)
    if changes:
        log_action(
            AuditAction.UPDATE,
            "operation",
            operation.id,
            f"Operação {operation.code} atualizada",
            changes=changes,
        )
    db.session.commit()
    return operation


def change_operation_status(operation: Operation, new_status: str, user) -> None:
    status = parse_choice(new_status, OperationStatus.ALL, "status")
    if operation.status == status:
        return
    before = operation.status
    operation.status = status
    operation.updated_by_id = user.id
    log_action(
        AuditAction.STATUS_CHANGE,
        "operation",
        operation.id,
        f"Operação {operation.code}: situação alterada de "
        f"{OperationStatus.LABELS.get(before, before)} para {OperationStatus.LABELS.get(status, status)}",
        changes={"status": [before, status]},
    )
    db.session.commit()


def delete_operation(operation: Operation, user) -> None:
    if user.role != Role.ADMIN:
        raise PermissionError("Apenas administradores podem excluir operações.")
    documents = list(operation.active_documents())
    loans = list(operation.active_loans())
    for document in documents:
        _set_operation_link(document, None, user.id)
    for loan in loans:
        _set_loan_link(loan, None, user.id)
    operation.soft_delete(user.id)
    log_action(
        AuditAction.DELETE,
        "operation",
        operation.id,
        f"Operação {operation.code} excluída logicamente",
        changes={
            "documents": [document.code for document in documents],
            "loans": [loan.code for loan in loans],
        },
    )
    db.session.commit()


def operation_history(operation: Operation) -> list[dict]:
    entries = (
        AuditLog.query.filter_by(entity="operation", entity_id=operation.id)
        .order_by(AuditLog.created_at.desc())
        .limit(40)
        .all()
    )
    return [entry.to_dict() for entry in entries]


def serialize_operation(operation: Operation, include_items: bool = True) -> dict:
    return operation.to_dict(include_items=include_items)


def available_documents(
    client_id: int, search: str | None = None, exclude_operation_id: int | None = None
) -> list[dict]:
    """Documents of a client that can be linked to an operation (not yet used)."""
    results: list[dict] = []
    for model, kind in ((Cheque, DocumentKind.CHEQUE), (Boleto, DocumentKind.BOLETO)):
        query = model.query.filter(
            model.is_deleted.is_(False),
            model.client_id == client_id,
            model.status != DocumentStatus.CANCELLED,
        )
        if exclude_operation_id:
            query = query.filter(
                or_(model.operation_id.is_(None), model.operation_id == exclude_operation_id)
            )
        else:
            query = query.filter(model.operation_id.is_(None))
        if search:
            like = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    model.code.ilike(like),
                    model.bank.ilike(like),
                    model.identifier.ilike(like),
                )
            )
        for document in query.order_by(model.due_date.asc(), model.id.asc()).limit(300).all():
            item = document.to_dict(include_notes=False)
            item["kind"] = kind
            results.append(item)
    results.sort(key=lambda item: (item.get("due_date") or "", item.get("code") or ""))
    return results


def available_loans(
    client_id: int, search: str | None = None, exclude_operation_id: int | None = None
) -> list[dict]:
    query = Loan.query.filter(
        Loan.is_deleted.is_(False),
        Loan.client_id == client_id,
        Loan.status != LoanStatus.CANCELLED,
    )
    if exclude_operation_id:
        query = query.filter(
            or_(Loan.operation_id.is_(None), Loan.operation_id == exclude_operation_id)
        )
    else:
        query = query.filter(Loan.operation_id.is_(None))
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(or_(Loan.code.ilike(like), Loan.notes.ilike(like)))
    return [
        loan.to_dict(include_items=False)
        for loan in query.order_by(Loan.loan_date.desc(), Loan.id.desc()).limit(300).all()
    ]


def _apply_filters(query, args):
    if args.get("status") in OperationStatus.ALL:
        query = query.filter(Operation.status == args["status"])
    if args.get("client_id"):
        try:
            query = query.filter(Operation.client_id == int(args["client_id"]))
        except (TypeError, ValueError):
            pass
    for arg, operator in (("date_from", "ge"), ("date_to", "le")):
        if args.get(arg):
            try:
                value = date.fromisoformat(args[arg])
            except ValueError:
                continue
            query = query.filter(
                Operation.operation_date >= value
                if operator == "ge"
                else Operation.operation_date <= value
            )

    search = (args.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        query = query.join(Client, Operation.client_id == Client.id).filter(
            or_(
                Operation.code.ilike(like),
                Operation.description.ilike(like),
                Client.name.ilike(like),
                Client.code.ilike(like),
            )
        )

    sort = args.get("sort") or "operation_date"
    allowed_sorts = {
        "code": Operation.code,
        "operation_date": Operation.operation_date,
        "created_at": Operation.created_at,
        "status": Operation.status,
    }
    column = allowed_sorts.get(sort, Operation.operation_date)
    if (args.get("order") or "desc").lower() == "asc":
        return query.order_by(column.asc(), Operation.id.asc())
    return query.order_by(column.desc(), Operation.id.desc())


def list_totals(query) -> dict:
    ids = [row[0] for row in query.order_by(None).with_entities(Operation.id).all()]
    result = {
        "operations": len(ids),
        "documents": 0,
        "loans": 0,
        "nominal": 0.0,
        "costs": 0.0,
        "net": 0.0,
        "applied_limit": 0.0,
        "loan_amount": 0.0,
        "loan_received_amount": 0.0,
        "loan_profit_amount": 0.0,
    }
    if not ids:
        return result
    for model in (Cheque, Boleto):
        documents = model.query.filter(
            model.is_deleted.is_(False), model.operation_id.in_(ids)
        ).all()
        for document in documents:
            result["documents"] += 1
            result["nominal"] += float(document_nominal(document))
            result["costs"] += float(document_costs(document))
            result["net"] += float(document.net_amount or 0)
            result["applied_limit"] += float(document.applied_limit or 0)
    for loan in Loan.query.filter(
        Loan.is_deleted.is_(False), Loan.operation_id.in_(ids)
    ).all():
        result["loans"] += 1
        result["loan_amount"] += float(loan.loan_amount or 0)
        result["loan_received_amount"] += float(loan.received_amount or 0)
        result["loan_profit_amount"] += float(loan.profit_amount or 0)
    return {
        key: (round(value, 2) if isinstance(value, float) else value)
        for key, value in result.items()
    }
