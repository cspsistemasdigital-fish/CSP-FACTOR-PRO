"""Relatório de empréstimos: filtros, cards, gráficos, PDF, planilha,
WhatsApp e e-mail.

Somente leitura: nenhum valor é recalculado. Todos os totais são agregações dos
valores informados nos empréstimos e parcelas. Exportações registram auditoria.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from urllib.parse import quote
from xml.sax.saxutils import escape

from sqlalchemy import or_

from ..extensions import db
from ..models import AuditAction, Client, Installment, Loan, LoanStatus
from ..utils.validators import ValidationError, clean_text, format_brl, parse_date, parse_int
from .audit import log_action
from .clients import exposure_map
from .loans import serialize_loan

PDF_ROW_LIMIT = 400
MAX_EXPORT_ROWS = 5000
MONTHLY_LIMIT = 24


def parse_loan_filters(args) -> dict:
    errors: dict[str, str] = {}
    try:
        date_from = parse_date(args.get("date_from"), "date_from", required=False)
        date_to = parse_date(args.get("date_to"), "date_to", required=False)
        client_id = parse_int(args.get("client_id"), "client_id", required=False, minimum=1)
    except ValidationError as exc:
        errors.update(exc.errors)
        date_from = date_to = client_id = None
    if date_from and date_to and date_from > date_to:
        errors["date_to"] = "A data inicial não pode ser maior que a data final."
    status = (args.get("status") or "").strip().upper() or None
    if status and status not in LoanStatus.ALL:
        errors["status"] = "Situação inválida."
    if errors:
        raise ValidationError(errors)
    return {
        "date_from": date_from,
        "date_to": date_to,
        "client_id": client_id,
        "status": status,
        "search": clean_text(args.get("search"), 120),
    }


def filters_as_dict(filters: dict) -> dict:
    return {
        "date_from": filters["date_from"].isoformat() if filters["date_from"] else None,
        "date_to": filters["date_to"].isoformat() if filters["date_to"] else None,
        "client_id": filters["client_id"],
        "status": filters["status"],
        "search": filters["search"],
    }


def _period_label(filters: dict) -> str:
    start = filters["date_from"].strftime("%d/%m/%Y") if filters["date_from"] else "início"
    end = filters["date_to"].strftime("%d/%m/%Y") if filters["date_to"] else "hoje"
    return f"{start} a {end}"


def _collect_loans(filters: dict) -> list[Loan]:
    query = Loan.query.filter(Loan.is_deleted.is_(False))
    if filters["status"] in LoanStatus.ALL:
        query = query.filter(Loan.status == filters["status"])
    if filters["client_id"]:
        query = query.filter(Loan.client_id == filters["client_id"])
    if filters["date_from"]:
        query = query.filter(Loan.loan_date >= filters["date_from"])
    if filters["date_to"]:
        query = query.filter(Loan.loan_date <= filters["date_to"])
    if filters["search"]:
        like = f"%{filters['search']}%"
        query = query.join(Client, Loan.client_id == Client.id).filter(
            or_(
                Loan.code.ilike(like),
                Loan.notes.ilike(like),
                Client.name.ilike(like),
                Client.code.ilike(like),
                Client.document.ilike(like),
            )
        )
    return query.order_by(Loan.loan_date.desc(), Loan.id.desc()).limit(MAX_EXPORT_ROWS).all()


def _installment_item(item: Installment, loan: Loan) -> dict:
    data = item.to_dict()
    data.update(
        {
            "loan_code": loan.code,
            "client_id": loan.client_id,
            "client_name": loan.client.name if loan.client else None,
            "client_code": loan.client.code if loan.client else None,
        }
    )
    return data


def build_report(filters: dict) -> dict:
    loans = _collect_loans(filters)
    loan_items = [serialize_loan(loan, include_items=False) for loan in loans]
    installment_items = [
        _installment_item(item, loan)
        for loan in loans
        for item in sorted(loan.active_installments(), key=lambda value: (value.due_date, value.number))
    ]

    totals = {
        "loans": len(loan_items),
        "loan_amount": 0.0,
        "received_amount": 0.0,
        "profit_amount": 0.0,
        "open_amount": 0.0,
        "divergences": 0,
        "installments": len(installment_items),
        "overdue_installments": 0,
        "clients": 0,
        "limits_exceeded": 0,
    }
    by_status = {
        status: {"status": status, "label": label, "count": 0, "loan_amount": 0.0, "profit_amount": 0.0}
        for status, label in LoanStatus.LABELS.items()
    }
    by_month: dict[str, dict] = {}
    per_client: dict[int, dict] = defaultdict(
        lambda: {
            "loans": 0,
            "loan_amount": 0.0,
            "received_amount": 0.0,
            "profit_amount": 0.0,
            "open_amount": 0.0,
            "installments": 0,
        }
    )
    for loan, item in zip(loans, loan_items):
        loan_amount = float(item["loan_amount"] or 0)
        profit = float(item["profit_amount"] or 0)
        totals["loan_amount"] += loan_amount
        totals["received_amount"] += float(item["received_amount"] or 0)
        totals["profit_amount"] += profit
        totals["open_amount"] += float(item["totals"]["open_amount"] or 0)
        totals["overdue_installments"] += int(item["totals"]["overdue_installments"])
        if item["has_divergence"]:
            totals["divergences"] += 1
        bucket = by_status[loan.status]
        bucket["count"] += 1
        bucket["loan_amount"] += loan_amount
        bucket["profit_amount"] += profit
        month = loan.loan_date.strftime("%Y-%m")
        monthly = by_month.setdefault(
            month,
            {
                "month": month,
                "label": loan.loan_date.strftime("%b/%Y"),
                "count": 0,
                "loan_amount": 0.0,
                "received_amount": 0.0,
                "profit_amount": 0.0,
            },
        )
        monthly["count"] += 1
        monthly["loan_amount"] += loan_amount
        monthly["received_amount"] += float(item["received_amount"] or 0)
        monthly["profit_amount"] += profit
        client_bucket = per_client[loan.client_id]
        client_bucket["loans"] += 1
        client_bucket["loan_amount"] += loan_amount
        client_bucket["received_amount"] += float(item["received_amount"] or 0)
        client_bucket["profit_amount"] += profit
        client_bucket["open_amount"] += float(item["totals"]["open_amount"] or 0)
        client_bucket["installments"] += int(item["totals"]["installments"])

    exposure = exposure_map(list(per_client))
    clients = []
    for client_id, bucket in per_client.items():
        client = db.session.get(Client, client_id)
        limit = Decimal(client.operational_limit or 0) if client else Decimal("0.00")
        available = limit - Decimal(bucket["open_amount"])
        exceeded = bool(limit > 0 and Decimal(exposure.get(client_id, {}).get("open_amount") or 0) > limit)
        clients.append(
            {
                "client_id": client_id,
                "code": client.code if client else None,
                "name": client.name if client else None,
                "whatsapp": client.whatsapp if client else None,
                "email": client.email if client else None,
                **{key: round(value, 2) if isinstance(value, float) else value for key, value in bucket.items()},
                "operational_limit": float(limit),
                "available_limit": float(available.quantize(Decimal("0.01"))),
                "limit_exceeded": exceeded,
            }
        )
    clients.sort(key=lambda row: (-row["loan_amount"], row["name"] or ""))
    totals["clients"] = len(clients)
    totals["limits_exceeded"] = sum(1 for row in clients if row["limit_exceeded"])

    cards = {
        "loans_count": totals["loans"],
        "loan_amount_total": round(totals["loan_amount"], 2),
        "received_amount_total": round(totals["received_amount"], 2),
        "profit_total": round(totals["profit_amount"], 2),
        "open_amount_total": round(totals["open_amount"], 2),
        "installments_count": totals["installments"],
        "overdue_installments": totals["overdue_installments"],
        "clients_count": totals["clients"],
        "limits_exceeded_count": totals["limits_exceeded"],
        "divergences_count": totals["divergences"],
    }
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "filters": filters_as_dict(filters),
        "period_label": _period_label(filters),
        "cards": cards,
        "by_status": list(by_status.values()),
        "by_month": sorted(by_month.values(), key=lambda row: row["month"])[-MONTHLY_LIMIT:],
        "clients": clients,
        "loans": loan_items,
        "installments": installment_items,
        "counts": {
            "loans": len(loan_items),
            "installments": len(installment_items),
            "clients": len(clients),
        },
    }


def build_whatsapp(client_id: int, filters: dict) -> dict:
    client = db.session.get(Client, client_id)
    if not client or client.is_deleted:
        raise ValidationError({"client_id": "Cliente não encontrado."})
    scoped = {**filters, "client_id": client_id}
    report = build_report(scoped)
    company_name = "FACTOR PRO"
    lines = [
        f"Olá, {client.name}!",
        "",
        f"Segue o resumo dos seus empréstimos ({report['period_label']}):",
        "",
    ]
    for loan in report["loans"][:20]:
        lines.append(
            f"• {loan['code']} — {loan['loan_date']} — empréstimo {format_brl(loan['loan_amount'])} "
            f"— você recebe {format_brl(loan['received_amount'])}"
        )
    lines += [
        "",
        f"Total emprestado: {format_brl(report['cards']['loan_amount_total'])}",
        f"Total recebido por você: {format_brl(report['cards']['received_amount_total'])}",
        f"Lucro de quem empresta: {format_brl(report['cards']['profit_total'])}",
        "",
        "Valores informados no sistema, sujeitos à conferência. Mensagem gerada automaticamente.",
        company_name,
    ]
    message = "\n".join(lines)
    phone = (client.whatsapp or client.phone or "").strip()
    digits = "".join(char for char in phone if char.isdigit())
    return {
        "client": {"id": client.id, "name": client.name, "code": client.code, "phone": phone},
        "message": message,
        "phone": digits,
        "url": f"https://wa.me/{digits}?text={quote(message)}" if digits else None,
        "loans_count": len(report["loans"]),
        "total": report["cards"]["loan_amount_total"],
        "profit": report["cards"]["profit_total"],
    }


def build_email(filters: dict) -> dict:
    report = build_report(filters)
    company = "FACTOR PRO"
    lines = [
        f"Relatório de Empréstimos — {report['period_label']}",
        "",
        f"Empréstimos: {report['cards']['loans_count']}",
        f"Valor total emprestado: {format_brl(report['cards']['loan_amount_total'])}",
        f"Valor recebido pelos clientes: {format_brl(report['cards']['received_amount_total'])}",
        f"Lucro informado: {format_brl(report['cards']['profit_total'])}",
        f"Saldo em aberto: {format_brl(report['cards']['open_amount_total'])}",
        f"Parcelas vencidas: {report['cards']['overdue_installments']}",
        "",
        "Por cliente:",
    ]
    for row in report["clients"][:30]:
        lines.append(
            f"• {row['name']} ({row['code']}) — {row['loans']} empréstimo(s) — "
            f"{format_brl(row['loan_amount'])} — lucro {format_brl(row['profit_amount'])}"
        )
    lines += [
        "",
        "Resumo gerado pelo FACTOR PRO a partir dos valores informados no sistema.",
        "Este é um resumo; para detalhes, exporte o PDF ou a planilha.",
    ]
    return {
        "subject": f"FACTOR PRO — Relatório de Empréstimos ({report['period_label']})",
        "body": "\n".join(lines),
        "preview": "\n".join(lines),
    }


def export_filename(extension: str) -> str:
    return f"emprestimos-factor-pro-{datetime.now():%Y%m%d-%H%M}.{extension}"


def audit_export(user, file_format: str, filters: dict) -> None:
    log_action(
        AuditAction.EXPORT,
        "loan_report",
        None,
        f"Relatório de empréstimos exportado em {file_format.upper()}",
        changes={"format": file_format.upper(), "filters": filters_as_dict(filters)},
        user=user,
        commit=True,
    )


def render_pdf(report: dict, company: dict, user) -> bytes:
    """A4 paisagem, cabeçalho/rodapé em todas as páginas e quebras explícitas."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
        title="Relatório de Empréstimos — FACTOR PRO",
        author=company.get("company_name") or "FACTOR PRO",
    )
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("FpNormal", parent=styles["Normal"], fontName="Helvetica", fontSize=8, leading=10)
    small = ParagraphStyle("FpSmall", parent=normal, fontSize=7, leading=9)
    heading = ParagraphStyle(
        "FpHeading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12,
        leading=15, spaceBefore=6, spaceAfter=5, textColor=colors.HexColor("#123D32")
    )
    brand = ParagraphStyle(
        "FpBrand", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=18,
        leading=21, textColor=colors.HexColor("#123D32")
    )
    muted = ParagraphStyle("FpMuted", parent=normal, fontSize=8, textColor=colors.HexColor("#5A6B64"))
    green = colors.HexColor("#123D32")
    green_light = colors.HexColor("#DDF4E8")
    petroleum = colors.HexColor("#173B57")
    grid = colors.HexColor("#D7E2DD")
    danger = colors.HexColor("#C9463D")

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#5A6B64"))
        canvas.drawString(12 * mm, 9 * mm, f"{company.get('company_name') or 'FACTOR PRO'} — Relatório de Empréstimos")
        canvas.drawRightString(landscape(A4)[0] - 12 * mm, 9 * mm, f"Página {document.page}")
        canvas.setStrokeColor(grid)
        canvas.line(12 * mm, 12 * mm, landscape(A4)[0] - 12 * mm, 12 * mm)
        canvas.restoreState()

    def table(data, widths, align_right=(), header_bg=green):
        result = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
        style = [
            ("BACKGROUND", (0, 0), (-1, 0), header_bg),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("LEADING", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.4, grid),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F7F6")]),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ]
        for column in align_right:
            style.append(("ALIGN", (column, 1), (column, -1), "RIGHT"))
        result.setStyle(TableStyle(style))
        return result

    story = []
    company_name = company.get("company_name") or "FACTOR PRO"
    story.append(Paragraph(escape(company_name), brand))
    contact = " · ".join(
        part for part in (company.get("company_document"), company.get("company_phone"), company.get("company_email")) if part
    )
    if contact:
        story.append(Paragraph(escape(contact), muted))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Relatório de Empréstimos", heading))
    story.append(Paragraph(f"Período: {escape(report['period_label'])}", normal))
    story.append(Paragraph(f"Gerado em: {escape(report['generated_at'])} por {escape(user.name if user else '—')}", muted))
    if report["filters"]["search"]:
        story.append(Paragraph(f"Busca: {escape(report['filters']['search'])}", muted))
    story.append(Spacer(1, 8))

    cards = report["cards"]
    card_data = [
        ["Empréstimos", "Valor emprestado", "Recebido pelos clientes", "Lucro informado"],
        [
            str(cards["loans_count"]),
            format_brl(cards["loan_amount_total"]),
            format_brl(cards["received_amount_total"]),
            format_brl(cards["profit_total"]),
        ],
        ["Parcelas", "Saldo em aberto", "Parcelas vencidas", "Clientes atendidos"],
        [
            str(cards["installments_count"]),
            format_brl(cards["open_amount_total"]),
            str(cards["overdue_installments"]),
            str(cards["clients_count"]),
        ],
    ]
    card_table = Table(card_data, colWidths=[62 * mm] * 4)
    card_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), green_light),
                ("BACKGROUND", (0, 2), (-1, 2), green_light),
                ("TEXTCOLOR", (0, 0), (-1, 0), petroleum),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"),
                ("FONTNAME", (0, 3), (-1, 3), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("GRID", (0, 0), (-1, -1), 0.4, grid),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(card_table)
    story.append(Spacer(1, 10))

    story.append(Paragraph("Empréstimos por situação", heading))
    status_data = [["Situação", "Empréstimos", "Valor emprestado", "Lucro informado"]]
    for row in report["by_status"]:
        status_data.append([row["label"], str(row["count"]), format_brl(row["loan_amount"]), format_brl(row["profit_amount"])])
    story.append(table(status_data, [50 * mm, 40 * mm, 70 * mm, 70 * mm], align_right=(1, 2, 3)))
    story.append(Spacer(1, 8))

    if report["by_month"]:
        story.append(Paragraph("Movimento mensal", heading))
        month_data = [["Mês", "Empréstimos", "Valor emprestado", "Lucro informado"]]
        for row in report["by_month"]:
            month_data.append([row["label"], str(row["count"]), format_brl(row["loan_amount"]), format_brl(row["profit_amount"])])
        story.append(table(month_data, [50 * mm, 40 * mm, 70 * mm, 70 * mm], align_right=(1, 2, 3)))

    if report["clients"]:
        story.append(PageBreak())
        story.append(Paragraph("Clientes e limites", heading))
        client_data = [["Cliente", "Empr.", "Emprestado", "Recebido", "Lucro", "Em aberto", "Limite", "Disponível"]]
        for row in report["clients"]:
            client_data.append(
                [
                    Paragraph(escape(f"{row['code']} · {row['name']}"), small),
                    str(row["loans"]),
                    format_brl(row["loan_amount"]),
                    format_brl(row["received_amount"]),
                    format_brl(row["profit_amount"]),
                    format_brl(row["open_amount"]),
                    format_brl(row["operational_limit"]),
                    format_brl(row["available_limit"]),
                ]
            )
        client_table = table(
            client_data,
            [55 * mm, 14 * mm, 32 * mm, 32 * mm, 30 * mm, 32 * mm, 30 * mm, 32 * mm],
            align_right=(1, 2, 3, 4, 5, 6, 7),
        )
        if any(row["limit_exceeded"] for row in report["clients"]):
            client_table.setStyle(TableStyle([("TEXTCOLOR", (7, 1), (7, -1), danger)]))
        story.append(client_table)

    if report["loans"]:
        story.append(PageBreak())
        story.append(Paragraph("Empréstimos", heading))
        loan_data = [["Código", "Data", "Cliente", "Empréstimo", "Recebido", "Lucro", "Situação", "Parcelas"]]
        for item in report["loans"][:PDF_ROW_LIMIT]:
            loan_data.append(
                [
                    item["code"],
                    item["loan_date"],
                    Paragraph(escape((item["client"] or {}).get("name") or ""), small),
                    format_brl(item["loan_amount"]),
                    format_brl(item["received_amount"]),
                    format_brl(item["profit_amount"]),
                    item["status_label"],
                    str(item["totals"]["installments"]),
                ]
            )
        story.append(
            table(
                loan_data,
                [24 * mm, 22 * mm, 58 * mm, 32 * mm, 32 * mm, 30 * mm, 26 * mm, 23 * mm],
                align_right=(3, 4, 5, 7),
            )
        )
        if len(report["loans"]) > PDF_ROW_LIMIT:
            story.append(Paragraph(f"Exibidos os primeiros {PDF_ROW_LIMIT} registros.", small))

    if report["installments"]:
        story.append(PageBreak())
        story.append(Paragraph("Parcelas e vencimentos", heading))
        parcel_data = [["Empréstimo", "Cliente", "Parcela", "Vencimento", "Valor", "Situação"]]
        for item in report["installments"][:PDF_ROW_LIMIT]:
            parcel_data.append(
                [
                    item["loan_code"],
                    Paragraph(escape(item["client_name"] or ""), small),
                    str(item["number"]),
                    item["due_date"],
                    format_brl(item["amount"]),
                    item["status_label"],
                ]
            )
        parcel_table = table(
            parcel_data,
            [32 * mm, 78 * mm, 20 * mm, 30 * mm, 35 * mm, 32 * mm],
            align_right=(2, 4),
        )
        story.append(parcel_table)
        story.append(Spacer(1, 6))
        story.append(
            Paragraph(
                "Os valores apresentados são os informados no sistema. "
                "O FACTOR PRO não calcula juros, descontos ou encargos automaticamente.",
                muted,
            )
        )

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def render_xlsx(report: dict, company: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    header_fill = PatternFill("solid", fgColor="123D32")
    header_font = Font(bold=True, color="FFFFFF")
    title_font = Font(bold=True, size=14, color="123D32")
    money_format = 'R$ #,##0.00'
    thin = Side(style="thin", color="D7E2DD")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    def setup(ws, title, headers, widths, freeze="A3"):
        ws["A1"] = title
        ws["A1"].font = title_font
        ws.append([])
        ws.append(headers)
        for cell in ws[3]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = border
        for index, width in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(index)].width = width
        ws.freeze_panes = freeze

    def write_rows(ws, rows, money_columns=()):
        for row in rows:
            ws.append(row)
            index = ws.max_row
            for column in money_columns:
                cell = ws.cell(row=index, column=column)
                cell.number_format = money_format
            for cell in ws[index]:
                cell.border = border

    cards = report["cards"]
    ws = workbook.active
    ws.title = "Resumo"
    setup(ws, "Relatório de Empréstimos", ["Indicador", "Valor"], [40, 26], freeze="A4")
    write_rows(
        ws,
        [
            ["Período", report["period_label"]],
            ["Gerado em", report["generated_at"]],
            ["Empresa", company.get("company_name") or "FACTOR PRO"],
            ["Empréstimos", cards["loans_count"]],
            ["Valor emprestado", cards["loan_amount_total"]],
            ["Recebido pelos clientes", cards["received_amount_total"]],
            ["Lucro informado", cards["profit_total"]],
            ["Saldo em aberto", cards["open_amount_total"]],
            ["Parcelas", cards["installments_count"]],
            ["Parcelas vencidas", cards["overdue_installments"]],
            ["Clientes", cards["clients_count"]],
            ["Limites ultrapassados", cards["limits_exceeded_count"]],
            ["Divergências informadas", cards["divergences_count"]],
        ],
        money_columns=(2,),
    )
    for row in (5, 6, 7, 8, 9, 10):
        ws.cell(row=row, column=1).number_format = "General"

    ws = workbook.create_sheet("Empréstimos")
    setup(
        ws,
        "Empréstimos",
        ["Código", "Data", "Cliente", "CPF/CNPJ", "Empréstimo", "Recebido", "Lucro", "Situação", "Parcelas", "Observações"],
        [15, 13, 34, 20, 18, 18, 16, 14, 12, 45],
    )
    write_rows(
        ws,
        [
            [
                item["code"],
                item["loan_date"],
                (item["client"] or {}).get("name"),
                (item["client"] or {}).get("document"),
                item["loan_amount"],
                item["received_amount"],
                item["profit_amount"],
                item["status_label"],
                item["totals"]["installments"],
                item["notes"],
            ]
            for item in report["loans"]
        ],
        money_columns=(5, 6, 7),
    )
    ws.auto_filter.ref = f"A3:J{max(3, ws.max_row)}"

    ws = workbook.create_sheet("Parcelas")
    setup(
        ws,
        "Parcelas e vencimentos",
        ["Empréstimo", "Cliente", "Parcela", "Vencimento", "Valor", "Situação", "Vencida"],
        [16, 34, 12, 14, 18, 16, 12],
    )
    write_rows(
        ws,
        [
            [
                item["loan_code"],
                item["client_name"],
                item["number"],
                item["due_date"],
                item["amount"],
                item["status_label"],
                "Sim" if item["is_overdue"] else "Não",
            ]
            for item in report["installments"]
        ],
        money_columns=(5,),
    )
    ws.auto_filter.ref = f"A3:G{max(3, ws.max_row)}"

    ws = workbook.create_sheet("Clientes")
    setup(
        ws,
        "Clientes e limites",
        ["Código", "Cliente", "Empréstimos", "Emprestado", "Recebido", "Lucro", "Em aberto", "Limite", "Disponível", "Limite excedido"],
        [14, 34, 14, 18, 18, 16, 18, 18, 18, 18],
    )
    write_rows(
        ws,
        [
            [
                row["code"],
                row["name"],
                row["loans"],
                row["loan_amount"],
                row["received_amount"],
                row["profit_amount"],
                row["open_amount"],
                row["operational_limit"],
                row["available_limit"],
                "Sim" if row["limit_exceeded"] else "Não",
            ]
            for row in report["clients"]
        ],
        money_columns=(4, 5, 6, 7, 8, 9),
    )
    ws.auto_filter.ref = f"A3:J{max(3, ws.max_row)}"

    return _workbook_bytes(workbook)


def _workbook_bytes(workbook) -> bytes:
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()
