"""Transactional e-mail delivery (password recovery and report sharing).

Delivery only happens when SMTP is configured (`MAIL_SERVER`). The system never
sends marketing e-mail. Sending a report always requires an explicit action of
the user (the address is typed by him and the message text is generated on
request). In development the reset token may also be returned by the API when
`EXPOSE_RESET_TOKEN=true`; that flag is always false in production.
"""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from flask import current_app


def mail_is_configured() -> bool:
    return bool(current_app.config.get("MAIL_SERVER"))


def build_reset_email(to_email: str, name: str, reset_url: str) -> EmailMessage:
    minutes = current_app.config.get("RESET_TOKEN_MINUTES", 30)
    message = EmailMessage()
    message["Subject"] = "FACTOR PRO — recuperação de senha"
    message["From"] = current_app.config.get(
        "MAIL_DEFAULT_SENDER", "FACTOR PRO <no-reply@factorpro.com.br>"
    )
    message["To"] = formataddr((name or to_email, to_email))
    message.set_content(
        "\n".join(
            [
                f"Olá, {name or 'tudo bem'}.",
                "",
                "Recebemos um pedido de recuperação de senha do FACTOR PRO.",
                f"Para definir uma nova senha, acesse o link abaixo (válido por {minutes} minutos):",
                "",
                reset_url,
                "",
                "Se você não fez este pedido, ignore esta mensagem: sua senha atual continua válida.",
                "",
                "Este é um e-mail automático e não recebe respostas.",
                "FACTOR PRO — Gestão Financeira Inteligente",
            ]
        )
    )
    return message


def send_text_email(to_email: str, subject: str, body: str, name: str | None = None) -> bool:
    """Send a plain-text message. Returns False when SMTP is not configured."""
    if not mail_is_configured():
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = current_app.config.get(
        "MAIL_DEFAULT_SENDER", "FACTOR PRO <no-reply@factorpro.com.br>"
    )
    message["To"] = formataddr((name or to_email, to_email))
    message.set_content(body)

    host = current_app.config["MAIL_SERVER"]
    port = int(current_app.config.get("MAIL_PORT", 587))
    timeout = int(current_app.config.get("MAIL_TIMEOUT_SECONDS", 10))

    if current_app.config.get("MAIL_USE_TLS"):
        with smtplib.SMTP(host, port, timeout=timeout) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            _authenticate(server)
            server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as server:
            server.ehlo()
            _authenticate(server)
            server.send_message(message)
    return True


def send_password_reset_email(to_email: str, name: str, reset_url: str) -> bool:
    """Try to deliver the reset link. Returns False when SMTP is not configured."""
    if not mail_is_configured():
        return False
    message = build_reset_email(to_email, name, reset_url)
    return send_text_email(
        to_email,
        message["Subject"],
        message.get_content(),
        name,
    )


def _authenticate(server: smtplib.SMTP) -> None:
    username = current_app.config.get("MAIL_USERNAME")
    if username:
        server.login(username, current_app.config.get("MAIL_PASSWORD", ""))
