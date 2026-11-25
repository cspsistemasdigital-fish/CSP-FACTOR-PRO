"""Generic Excel export of saved records shown on list screens (Etapa 8).

Every list screen offers the same "Exportar Excel" button. This module applies
the *same* filters used by the paginated list (without pagination) and renders
a branded workbook following the project's openpyxl conventions — no monetary
value is ever recalculated, only the stored values are copied.
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from io import BytesIO

from flask import current_app
from sqlalchemy import false

from ..extensions import db
from ..models import (
    AuditLog,
    Boleto,
    Cheque,
    Client,
    ClientStatus,
    Loan,
    Operation,
    Receipt,
    Role,
    User,
)
from ..utils.validators import clean_text
from .branding import brand_logo_path, company_display_name, export_slug
from .clients import overdue_client_ids, serialize_clients
from .documents import _apply_filters as _apply_document_filters
from .loans import _apply_filters as _apply_loan_filters
from .operations import _apply_filters as _apply_operation_filters
from .receipts import _apply_filters as _apply_receipt_filters, serialize_receipt

RESOURCE_LABELS = {
    "clients": "Clientes",
    "cheques": "Cheques",
    "boletos": "Boletos",
    "operations": "Operações",
    "receipts": "Recebimentos",
    "loans": "Empréstimos",
    "users": "Usuários",
    "audit": "Auditoria",
}
ADMIN_ONLY = {"users", "audit"}


def _sim(value) -> str:
    return "Sim" if value else "Não"


def _client_query(args):
    query = Client.query.filter(Client.is_deleted.is_(False))
    search = clean_text(args.get("search"))
    if search:
        like = f"%{search}%"
        digits = "".join(ch for ch in search if ch.isdigit())
        conditions = [
            Client.name.ilike(like),
            Client.code.ilike(like),
            Client.email.ilike(like),
            Client.city.ilike(like),
            Client.document.ilike(f"%{digits}%") if digits else Client.document.ilike(like),
        ]
        query = query.filter(db.or_(*conditions))
    if args.get("status") in ClientStatus.ALL:
        query = query.filter(Client.status == args["status"])
    if args.get("blocked") in ("1", "true", "True"):
        query = query.filter(Client.is_blocked.is_(True))
    elif args.get("blocked") in ("0", "false", "False"):
        query = query.filter(Client.is_blocked.is_(False))
    if args.get("overdue") in ("1", "true", "True"):
        ids = overdue_client_ids()
        query = query.filter(Client.id.in_(ids) if ids else false())
    return query.order_by(Client.name.asc(), Client.id.asc())


def _audit_query(args):
    query = AuditLog.query
    if args.get("entity"):
        query = query.filter(AuditLog.entity == args["entity"])
    if args.get("action"):
        query = query.filter(AuditLog.action == args["action"])
    if args.get("user_id"):
        try:
            query = query.filter(AuditLog.user_id == int(args["user_id"]))
        except ValueError:
            pass
    if args.get("search"):
        like = f"%{args['search'].strip()}%"
        query = query.filter(
            db.or_(
                AuditLog.description.ilike(like),
                AuditLog.user_email.ilike(like),
                AuditLog.entity.ilike(like),
            )
        )
    try:
        if args.get("date_from"):
            start = date.fromisoformat(args["date_from"])
            query = query.filter(AuditLog.created_at >= datetime.combine(start, time.min, tzinfo=timezone.utc))
        if args.get("date_to"):
            end = date.fromisoformat(args["date_to"])
            query = query.filter(AuditLog.created_at <= datetime.combine(end, time.max, tzinfo=timezone.utc))
    except ValueError:
        pass
    return query.order_by(AuditLog.created_at.desc())


def build_rows(resource: str, args) -> dict | None:
    """Return title/headers/rows/money columns for *resource* or None if unknown."""
    if resource == "clients":
        items = serialize_clients(_client_query(args).all())
        headers = [
            "Código", "Nome", "Tipo", "Documento", "Telefone", "E-mail", "Cidade", "UF",
            "Limite operacional", "Exposição em aberto", "Disponível", "Uso %",
            "Situação", "Cadastrado em",
        ]
        rows = []
        for item in items:
            summary = item["summary"]
            rows.append([
                item["code"], item["name"], item["person_type"], item["document"],
                item.get("phone") or "", item.get("email") or "", item.get("city") or "",
                item.get("state") or "", summary["operational_limit"], summary["open_amount"],
                summary["available_limit"], summary["limit_usage_percent"],
                item["status_label"], item.get("registered_at") or "",
            ])
        return {"headers": headers, "rows": rows, "money_columns": (9, 10, 11), "percent_columns": (12,)}

    if resource in {"cheques", "boletos"}:
        model = Cheque if resource == "cheques" else Boleto
        kind = "cheque" if resource == "cheques" else "boleto"
        query = _apply_document_filters(model.query.filter(model.is_deleted.is_(False)), model, args, kind)
        items = [item.to_dict() for item in query.order_by(model.due_date.asc(), model.id.asc()).all()]
        if resource == "cheques":
            headers = [
                "Código", "Identificador", "Número", "Banco", "Agência", "Conta", "Cliente",
                "Emitente", "Documento emitente", "Valor nominal", "Desconto", "Juros",
                "Outras despesas", "Valor líquido", "Divergência", "Emissão", "Vencimento",
                "Operação", "Situação", "Vencido?", "Observações",
            ]
            rows = [
                [
                    item["code"], item.get("identifier") or "", item.get("number") or "",
                    item.get("bank") or "", item.get("agency") or "", item.get("account") or "",
                    (item.get("client") or {}).get("name") or "", item.get("issuer_name") or "",
                    item.get("issuer_document") or "", item["nominal_amount"],
                    item["discount_amount"], item["interest_amount"], item["other_expenses"],
                    item["net_amount"], item["divergence_amount"], item.get("issue_date") or "",
                    item.get("due_date") or "", item.get("operation_date") or "",
                    item["status_label"], _sim(item["is_overdue"]), item.get("notes") or "",
                ]
                for item in items
            ]
            money_columns = (10, 11, 12, 13, 14, 15)
        else:
            headers = [
                "Código", "Identificador", "Banco", "Cliente", "Beneficiário",
                "Documento beneficiário", "Valor original", "Desconto", "Outras despesas",
                "Valor líquido", "Divergência", "Emissão", "Vencimento", "Operação",
                "Situação", "Vencido?", "Observações",
            ]
            rows = [
                [
                    item["code"], item.get("identifier") or "", item.get("bank") or "",
                    (item.get("client") or {}).get("name") or "", item.get("beneficiary_name") or "",
                    item.get("beneficiary_document") or "", item["original_amount"],
                    item["discount_amount"], item["other_expenses"], item["net_amount"],
                    item["divergence_amount"], item.get("issue_date") or "",
                    item.get("due_date") or "", item.get("operation_date") or "",
                    item["status_label"], _sim(item["is_overdue"]), item.get("notes") or "",
                ]
                for item in items
            ]
            money_columns = (7, 8, 9, 10, 11)
        return {"headers": headers, "rows": rows, "money_columns": money_columns, "percent_columns": ()}

    if resource == "operations":
        query = _apply_operation_filters(Operation.query.filter(Operation.is_deleted.is_(False)), args)
        items = [item.to_dict(include_items=False) for item in query.order_by(Operation.operation_date.desc(), Operation.id.desc()).all()]
        headers = [
            "Código", "Cliente", "Data da operação", "Descrição", "Situação",
            "Qtd. documentos", "Valor nominal", "Custos informados", "Valor líquido",
            "Qtd. empréstimos", "Valor emprestado", "Valor recebido pelo cliente",
            "Lucro informado", "Criado em", "Observações",
        ]
        rows = [
            [
                item["code"], (item.get("client") or {}).get("name") or "",
                item.get("operation_date") or "", item.get("description") or "",
                item["status_label"], item["totals"]["documents"], item["totals"]["nominal"],
                item["totals"]["costs"], item["totals"]["net"], item["totals"]["loans"],
                item["totals"]["loan_amount"], item["totals"]["loan_received_amount"],
                item["totals"]["loan_profit_amount"], item.get("created_at") or "",
                item.get("notes") or "",
            ]
            for item in items
        ]
        return {"headers": headers, "rows": rows, "money_columns": (7, 8, 9, 11, 12, 13), "percent_columns": ()}

    if resource == "receipts":
        query = _apply_receipt_filters(Receipt.query.filter(Receipt.is_deleted.is_(False)), args)
        items = [serialize_receipt(item) for item in query.order_by(Receipt.receipt_date.desc(), Receipt.id.desc()).all()]
        headers = [
            "Código", "Tipo", "Documento", "Cliente", "Data do recebimento",
            "Valor recebido", "Líquido do título", "Total recebido", "Saldo",
            "Liquidado?", "Observações",
        ]
        rows = [
            [
                item["code"], item["document_label"],
                ((item.get("document") or {}).get("code") or ""),
                (item.get("client") or {}).get("name") or "", item.get("receipt_date") or "",
                item["amount"], item["document_net"], item["received_total"],
                item["remaining_amount"], _sim(item["is_settled"]), item.get("notes") or "",
            ]
            for item in items
        ]
        return {"headers": headers, "rows": rows, "money_columns": (6, 7, 8, 9), "percent_columns": ()}

    if resource == "loans":
        query = _apply_loan_filters(Loan.query.filter(Loan.is_deleted.is_(False)), args)
        items = [item.to_dict(include_items=False) for item in query.order_by(Loan.loan_date.desc(), Loan.id.desc()).all()]
        headers = [
            "Código", "Cliente", "Data do empréstimo", "Valor emprestado", "Valor recebido",
            "Lucro informado", "Situação", "Qtd. parcelas", "Total das parcelas",
            "Em aberto", "Divergência", "Criado em", "Observações",
        ]
        rows = [
            [
                item["code"], (item.get("client") or {}).get("name") or "",
                item.get("loan_date") or "", item["loan_amount"], item["received_amount"],
                item["profit_amount"], item["status_label"], item["totals"]["installments"],
                item["totals"]["scheduled"], item["totals"]["open_amount"], item["divergence"],
                item.get("created_at") or "", item.get("notes") or "",
            ]
            for item in items
        ]
        return {"headers": headers, "rows": rows, "money_columns": (4, 5, 6, 9, 10, 11), "percent_columns": ()}

    if resource == "users":
        items = User.query.order_by(User.is_active.desc(), User.name.asc()).all()
        headers = ["Nome", "E-mail", "Perfil", "Ativo", "Cadastrado em", "Último acesso"]
        rows = [
            [
                item.name, item.email, Role.LABELS.get(item.role, item.role),
                _sim(item.is_active), item.created_at.strftime("%d/%m/%Y %H:%M") if item.created_at else "",
                item.last_login_at.strftime("%d/%m/%Y %H:%M") if getattr(item, "last_login_at", None) else "",
            ]
            for item in items
        ]
        return {"headers": headers, "rows": rows, "money_columns": (), "percent_columns": ()}

    if resource == "audit":
        items = _audit_query(args).all()
        headers = ["Data/hora", "Usuário", "Ação", "Entidade", "ID", "Descrição", "IP"]
        rows = []
        for item in items:
            user_label = (item.user.name if item.user else None) or item.user_email or ""
            rows.append([
                item.created_at.strftime("%d/%m/%Y %H:%M:%S") if item.created_at else "",
                user_label, item.action, item.entity, item.entity_id,
                item.description, item.ip_address or "",
            ])
        return {"headers": headers, "rows": rows, "money_columns": (), "percent_columns": ()}

    return None


def render_list_xlsx(spec: dict, title: str, company: dict) -> bytes:
    """Render one styled sheet using the same visual language as the reports."""
    from openpyxl import Workbook
    from openpyxl.drawing.image import Image as XLImage
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = title[:31]

    header_fill = PatternFill("solid", fgColor="123D32")
    header_font = Font(color="FFFFFF", bold=True)
    title_font = Font(bold=True, size=14, color="123D32")
    subtitle_font = Font(italic=True, color="4A6158")
    thin = Side(style="thin", color="D7E2DD")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    money_format = 'R$ #,##0.00'
    percent_format = '0.00"%"'

    headers = spec["headers"]
    rows = spec["rows"]
    money_columns = {index + 1 for index in spec.get("money_columns", ())}
    percent_columns = {index + 1 for index in spec.get("percent_columns", ())}

    ws["A1"] = company_display_name(company)
    ws["A1"].font = title_font
    ws["A2"] = f"{title} · {len(rows)} registro(s) · gerado em {datetime.now():%d/%m/%Y %H:%M}"
    ws["A2"].font = subtitle_font

    logo_path = brand_logo_path(company)
    if logo_path:
        try:
            image = XLImage(logo_path)
            image.width = min(image.width, 220)
            image.height = min(image.height, 64)
            ws.add_image(image, f"{get_column_letter(len(headers) + 2)}1")
        except Exception:  # pragma: no cover - a logo must never break an export
            pass

    header_row = 4
    for column, label in enumerate(headers, start=1):
        cell = ws.cell(row=header_row, column=column, value=label)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border

    for offset, row in enumerate(rows, start=header_row + 1):
        for column, value in enumerate(row, start=1):
            cell = ws.cell(row=offset, column=column, value=value)
            cell.border = border
            if column in money_columns and isinstance(value, (int, float)):
                cell.number_format = money_format
            if column in percent_columns and isinstance(value, (int, float)):
                cell.number_format = percent_format

    for column, label in enumerate(headers, start=1):
        longest = max(
            [len(str(label))] + [len(str(row[column - 1])) for row in rows[:200] if column <= len(row)] or [10]
        )
        width = min(max(longest + 3, 12), 44)
        ws.column_dimensions[get_column_letter(column)].width = width

    ws.freeze_panes = f"A{header_row + 1}"
    ws.auto_filter.ref = f"A{header_row}:{get_column_letter(len(headers))}{max(header_row, ws.max_row)}"

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def export_filename(resource: str, company: dict) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return f"{resource}-{export_slug(company)}-{stamp}.xlsx"
