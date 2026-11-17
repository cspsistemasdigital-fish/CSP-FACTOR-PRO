"""Flask CLI commands: seed administrator, demo data and password recovery."""
from __future__ import annotations

import secrets
from datetime import date, timedelta

import click
from flask import current_app

from .extensions import db
from .models import Boleto, Cheque, Client, Role, Setting, User
from .services.documents import create_boleto, create_cheque
from .services.operations import create_operation
from .services.receipts import create_receipt
from .api.settings import DEFAULTS


def _ensure_company_settings() -> None:
    for key, value in DEFAULTS.items():
        if not db.session.get(Setting, key):
            db.session.add(Setting(key=key, value=value))
    db.session.commit()


def register_cli(app):
    @app.cli.command("seed")
    def seed():
        """Create tables (if needed), the administrator user and company defaults."""
        db.create_all()
        _ensure_company_settings()

        email = app.config["ADMIN_EMAIL"].strip().lower()
        admin = User.query.filter(db.func.lower(User.email) == email).first()
        created = False
        if not admin:
            admin = User(
                name=app.config["ADMIN_NAME"],
                email=email,
                role=Role.ADMIN,
                is_active=True,
                must_change_password=True,
            )
            admin.set_password(app.config["ADMIN_PASSWORD"])
            db.session.add(admin)
            db.session.commit()
            created = True

        click.echo("=" * 62)
        click.echo(" FACTOR PRO - banco preparado")
        click.echo("=" * 62)
        if created:
            click.echo(f" Administrador criado: {email}")
            click.echo(f" Senha inicial: {app.config['ADMIN_PASSWORD']}")
            click.echo(" Altere a senha no primeiro acesso.")
        else:
            click.echo(f" Administrador já existente: {email}")
        click.echo(" Use 'flask seed-demo' para dados demonstrativos (opcional).")

    @app.cli.command("seed-demo")
    @click.option("--force", is_flag=True, help="Create demo data even if clients already exist.")
    def seed_demo(force: bool):
        """Create clearly labelled [DEMO] clients, cheques and boletos."""
        db.create_all()
        _ensure_company_settings()
        admin = User.query.filter(User.role == Role.ADMIN).first()
        if not admin:
            raise click.ClickException("Execute 'flask seed' antes de criar dados demonstrativos.")
        if Client.query.filter(Client.is_deleted.is_(False)).count() > 0 and not force:
            raise click.ClickException(
                "Já existem clientes cadastrados. Use --force apenas em ambiente de testes."
            )

        today = date.today()
        demo_clients = [
            {
                "name": "[DEMO] Comércio Silva Ltda",
                "document": "11.222.333/0001-81",
                "email": "demo.silva@example.com",
                "phone": "(11) 98888-1001",
                "whatsapp": "(11) 98888-1001",
                "address": "Rua das Palmeiras, 120",
                "city": "São Paulo",
                "state": "SP",
                "zip_code": "01310-100",
                "operational_limit": "50000.00",
            },
            {
                "name": "[DEMO] Maria Oliveira",
                "document": "529.982.247-25",
                "email": "demo.maria@example.com",
                "phone": "(19) 97777-2002",
                "whatsapp": "(19) 97777-2002",
                "address": "Av. Central, 45",
                "city": "Campinas",
                "state": "SP",
                "zip_code": "13010-200",
                "operational_limit": "15000.00",
            },
            {
                "name": "[DEMO] Distribuidora Horizonte ME",
                "document": "11.444.777/0001-61",
                "email": "demo.horizonte@example.com",
                "phone": "(31) 96666-3003",
                "whatsapp": "(31) 96666-3003",
                "address": "Rua da Bahia, 900",
                "city": "Belo Horizonte",
                "state": "MG",
                "zip_code": "30160-010",
                "operational_limit": "30000.00",
            },
        ]

        clients = []
        for index, data in enumerate(demo_clients, start=1):
            client = Client(
                code=f"CLI-DEMO{index}",
                person_type="PJ" if len(data["document"]) > 15 else "PF",
                document="".join(ch for ch in data["document"] if ch.isalnum()).upper(),
                name=data["name"],
                phone="".join(ch for ch in data["phone"] if ch.isdigit()),
                whatsapp="".join(ch for ch in data["whatsapp"] if ch.isdigit()),
                email=data["email"],
                address=data["address"],
                city=data["city"],
                state=data["state"],
                zip_code="".join(ch for ch in data["zip_code"] if ch.isdigit()),
                registered_at=today - timedelta(days=90),
                operational_limit=data["operational_limit"],
                status="ATIVO",
                created_by_id=admin.id,
            )
            db.session.add(client)
            clients.append(client)
        db.session.commit()

        cheques = [
            {
                "client": clients[0],
                "number": "000123",
                "bank": "Banco do Brasil",
                "agency": "1234",
                "account": "56789-0",
                "issuer_document": clients[0].document,
                "issuer_name": clients[0].name,
                "nominal_amount": "12000.00",
                "discount_amount": "600.00",
                "interest_amount": "0.00",
                "other_expenses": "50.00",
                "net_amount": "11350.00",
                "operation_date": (today - timedelta(days=20)).isoformat(),
                "due_date": (today - timedelta(days=5)).isoformat(),
                "status": "EM_ABERTO",
            },
            {
                "client": clients[0],
                "number": "000456",
                "bank": "Itaú Unibanco",
                "agency": "4321",
                "account": "11223-4",
                "issuer_document": clients[0].document,
                "issuer_name": clients[0].name,
                "nominal_amount": "8000.00",
                "discount_amount": "400.00",
                "net_amount": "7600.00",
                "operation_date": today.isoformat(),
                "due_date": (today + timedelta(days=10)).isoformat(),
                "status": "EM_ABERTO",
            },
            {
                "client": clients[1],
                "number": "000789",
                "bank": "Bradesco",
                "agency": "2211",
                "account": "99887-6",
                "issuer_document": clients[1].document,
                "issuer_name": clients[1].name,
                "nominal_amount": "3500.00",
                "discount_amount": "175.00",
                "other_expenses": "25.00",
                "net_amount": "3300.00",
                "operation_date": (today - timedelta(days=60)).isoformat(),
                "due_date": (today - timedelta(days=40)).isoformat(),
                "status": "LIQUIDADO",
            },
            {
                "client": clients[2],
                "number": "000999",
                "bank": "Santander",
                "agency": "7788",
                "account": "44556-7",
                "issuer_document": clients[2].document,
                "issuer_name": clients[2].name,
                "nominal_amount": "22000.00",
                "discount_amount": "1100.00",
                "net_amount": "20900.00",
                "operation_date": (today - timedelta(days=3)).isoformat(),
                "due_date": (today + timedelta(days=3)).isoformat(),
                "status": "EM_ABERTO",
            },
        ]

        boletos = [
            {
                "client": clients[1],
                "identifier": "BOL-DEMO-001",
                "barcode": "34191790010104351004791020150008291070026000",
                "bank": "Banco Inter",
                "beneficiary_document": clients[1].document,
                "beneficiary_name": clients[1].name,
                "original_amount": "4200.00",
                "discount_amount": "210.00",
                "other_expenses": "0.00",
                "net_amount": "3990.00",
                "operation_date": today.isoformat(),
                "due_date": (today + timedelta(days=15)).isoformat(),
                "status": "EM_ABERTO",
            },
            {
                "client": clients[2],
                "identifier": "BOL-DEMO-002",
                "barcode": "75691370000073000000000000000000000000000000",
                "bank": "Sicoob",
                "beneficiary_document": clients[2].document,
                "beneficiary_name": clients[2].name,
                "original_amount": "7300.00",
                "discount_amount": "365.00",
                "net_amount": "6935.00",
                "operation_date": (today - timedelta(days=30)).isoformat(),
                "due_date": (today - timedelta(days=2)).isoformat(),
                "status": "EM_ABERTO",
            },
            {
                "client": clients[0],
                "identifier": "BOL-DEMO-003",
                "barcode": "00190500954014481606906809350314337370000000100",
                "bank": "Banco do Brasil",
                "beneficiary_document": clients[0].document,
                "beneficiary_name": clients[0].name,
                "original_amount": "9800.00",
                "discount_amount": "490.00",
                "net_amount": "9310.00",
                "operation_date": (today - timedelta(days=10)).isoformat(),
                "due_date": (today + timedelta(days=40)).isoformat(),
                "status": "EM_ABERTO",
            },
        ]

        for payload in cheques:
            payload["client_id"] = payload.pop("client").id
            create_cheque(payload, admin)
        for payload in boletos:
            payload["client_id"] = payload.pop("client").id
            create_boleto(payload, admin)

        # Stable, human friendly codes for demo records.
        for index, cheque in enumerate(Cheque.query.order_by(Cheque.id.asc()).all(), start=1):
            cheque.code = f"CHQ-DEMO{index:03d}"
        for index, boleto in enumerate(Boleto.query.order_by(Boleto.id.asc()).all(), start=1):
            boleto.code = f"BOL-DEMO{index:03d}"
        db.session.commit()

        # Demo operation grouping the first client's cheques.
        demo_cheques = (
            Cheque.query.filter(Cheque.client_id == clients[0].id, Cheque.is_deleted.is_(False))
            .order_by(Cheque.id.asc())
            .all()
        )
        if demo_cheques:
            operation = create_operation(
                {
                    "client_id": clients[0].id,
                    "operation_date": today.isoformat(),
                    "description": "[DEMO] Borderô de compra de títulos",
                    "documents": [{"kind": "CHEQUE", "id": cheque.id} for cheque in demo_cheques],
                },
                admin,
            )
            operation.code = "OPR-DEMO001"
            db.session.commit()

        # Demo partial receipt on the third client's open boleto.
        demo_boleto = (
            Boleto.query.filter(Boleto.client_id == clients[2].id, Boleto.is_deleted.is_(False))
            .order_by(Boleto.id.asc())
            .first()
        )
        if demo_boleto:
            receipt, _ = create_receipt(
                {
                    "document_kind": "BOLETO",
                    "document_id": demo_boleto.id,
                    "receipt_date": today.isoformat(),
                    "amount": "2000.00",
                    "notes": "[DEMO] Recebimento parcial informado manualmente.",
                },
                admin,
            )
            receipt.code = "REC-DEMO001"
            db.session.commit()

        click.echo(
            f"Dados demonstrativos criados: {len(clients)} clientes, {len(cheques)} cheques e "
            f"{len(boletos)} boletos (todos identificados com [DEMO]), além de 1 operação e "
            "1 recebimento parcial."
        )

    @app.cli.command("reset-admin-password")
    @click.option("--email", required=True, help="E-mail do administrador.")
    @click.option("--password", default=None, help="Nova senha (gerada automaticamente se omitida).")
    def reset_admin_password(email: str, password: str | None):
        """Reset an administrator password from the server console."""
        user = User.query.filter(db.func.lower(User.email) == email.strip().lower()).first()
        if not user:
            raise click.ClickException("Usuário não encontrado.")
        if user.role != Role.ADMIN:
            raise click.ClickException("O usuário informado não é administrador.")
        new_password = password or f"Fp{secrets.token_urlsafe(9)}1"
        user.set_password(new_password)
        user.is_active = True
        user.must_change_password = True
        db.session.commit()
        click.echo(f"Senha redefinida para {user.email}. Nova senha: {new_password}")
        click.echo("O usuário deverá alterá-la no próximo acesso.")

    @app.cli.command("create-db")
    def create_db():
        """Create all tables (development shortcut; use 'flask db upgrade' otherwise)."""
        db.create_all()
        click.echo("Tabelas criadas/verificadas com sucesso.")
