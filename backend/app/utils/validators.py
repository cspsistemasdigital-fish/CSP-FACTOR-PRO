"""Input parsing and Brazilian document validation helpers."""
from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from email_validator import EmailNotValidError, validate_email

BRAZILIAN_STATES = {
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
    "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
}


class ValidationError(Exception):
    """Raised when one or more fields are invalid."""

    def __init__(self, errors: dict[str, str], message: str = "Verifique os campos informados."):
        super().__init__(message)
        self.errors = errors
        self.message = message


def normalize_document(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^0-9A-Za-z]", "", str(value)).upper()


def only_digits(value: str | None) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _cnpj_char_value(char: str) -> int:
    """Receita Federal rule for numeric and alphanumeric CNPJ (2026+)."""
    return ord(char) - 48


def is_valid_cpf(value: str) -> bool:
    cpf = only_digits(value)
    if len(cpf) != 11 or len(set(cpf)) == 1:
        return False
    for index in (9, 10):
        total = sum(int(cpf[number]) * ((index + 1) - number) for number in range(index))
        digit = ((total * 10) % 11) % 10
        if int(cpf[index]) != digit:
            return False
    return True


def is_valid_cnpj(value: str) -> bool:
    cnpj = normalize_document(value)
    if len(cnpj) != 14 or len(set(cnpj)) == 1:
        return False
    if not cnpj[:12].isalnum() or not cnpj[12:].isdigit():
        return False

    def check_digit(weights: list[int]) -> int:
        total = sum(_cnpj_char_value(char) * weight for char, weight in zip(cnpj, weights))
        remainder = total % 11
        return 0 if remainder < 2 else 11 - remainder

    weights_first = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    weights_second = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    return int(cnpj[12]) == check_digit(weights_first) and int(cnpj[13]) == check_digit(weights_second)


def validate_document(value: str, field: str = "document") -> tuple[str, str]:
    """Return (normalized_document, person_type) or raise ValidationError."""
    normalized = normalize_document(value)
    if not normalized:
        raise ValidationError({field: "Informe o CPF ou CNPJ."})
    if len(normalized) == 11:
        if not normalized.isdigit() or not is_valid_cpf(normalized):
            raise ValidationError({field: "CPF inválido."})
        return normalized, "PF"
    if len(normalized) == 14:
        if not is_valid_cnpj(normalized):
            raise ValidationError({field: "CNPJ inválido."})
        return normalized, "PJ"
    raise ValidationError({field: "CPF deve ter 11 dígitos ou CNPJ deve ter 14 caracteres."})


def parse_money(
    value,
    field: str,
    *,
    required: bool = True,
    allow_zero: bool = True,
    label: str | None = None,
) -> Decimal:
    label = label or field
    if value is None or value == "":
        if required:
            raise ValidationError({field: f"Informe {label}."})
        return Decimal("0.00")
    if isinstance(value, bool):
        raise ValidationError({field: f"{label} inválido."})
    if isinstance(value, (int, float, Decimal)):
        raw = str(value)
    else:
        raw = str(value).strip().replace("R$", "").replace(" ", "")
        # Accept both "1.234,56" (pt-BR) and "1234.56"
        if "," in raw:
            raw = raw.replace(".", "").replace(",", ".")
    try:
        amount = Decimal(raw)
    except (InvalidOperation, ValueError):
        raise ValidationError({field: f"{label} inválido."})
    if amount < 0:
        raise ValidationError({field: f"{label} não pode ser negativo."})
    if amount == 0 and not allow_zero:
        raise ValidationError({field: f"{label} deve ser maior que zero."})
    return amount.quantize(Decimal("0.01"))


def parse_date(value, field: str, *, required: bool = True, label: str | None = None) -> date | None:
    label = label or field
    if value is None or value == "":
        if required:
            raise ValidationError({field: f"Informe {label}."})
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        raise ValidationError({field: f"{label} inválida. Use o formato AAAA-MM-DD."})


def format_brl(value) -> str:
    """Format a number as Brazilian currency (used in validation messages)."""
    number = Decimal(value or 0).quantize(Decimal("0.01"))
    return f"R$ {number:,.2f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def parse_int(value, field: str, *, required: bool = False, minimum: int | None = None) -> int | None:
    if value is None or value == "":
        if required:
            raise ValidationError({field: "Campo obrigatório."})
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError({field: "Valor numérico inválido."})
    if minimum is not None and number < minimum:
        raise ValidationError({field: f"Valor mínimo: {minimum}."})
    return number


def parse_email(value, field: str = "email", *, required: bool = False) -> str | None:
    text = (value or "").strip()
    if not text:
        if required:
            raise ValidationError({field: "Informe o e-mail."})
        return None
    try:
        result = validate_email(text, check_deliverability=False)
        return result.normalized
    except EmailNotValidError:
        raise ValidationError({field: "E-mail inválido."})


def parse_phone(value, field: str, *, required: bool = False) -> str | None:
    digits = only_digits(value)
    if not digits:
        if required:
            raise ValidationError({field: "Informe o telefone."})
        return None
    if len(digits) not in (10, 11):
        raise ValidationError({field: "Telefone deve ter DDD + número (10 ou 11 dígitos)."})
    return digits


def parse_zip(value, field: str = "zip_code", *, required: bool = False) -> str | None:
    digits = only_digits(value)
    if not digits:
        if required:
            raise ValidationError({field: "Informe o CEP."})
        return None
    if len(digits) != 8:
        raise ValidationError({field: "CEP deve ter 8 dígitos."})
    return digits


def parse_state(value, field: str = "state") -> str | None:
    text = (value or "").strip().upper()
    if not text:
        return None
    if text not in BRAZILIAN_STATES:
        raise ValidationError({field: "UF inválida."})
    return text


def clean_text(value, max_length: int | None = None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if max_length and len(text) > max_length:
        text = text[:max_length]
    return text


def parse_choice(value, allowed, field: str, *, required: bool = True, default=None):
    if value is None or value == "":
        if required:
            raise ValidationError({field: "Campo obrigatório."})
        return default
    if value not in allowed:
        raise ValidationError({field: "Valor inválido."})
    return value


def validate_password_strength(password: str, field: str = "password") -> str:
    if not password or len(password) < 8:
        raise ValidationError({field: "A senha deve ter no mínimo 8 caracteres."})
    if len(password) > 128:
        raise ValidationError({field: "A senha deve ter no máximo 128 caracteres."})
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ValidationError({field: "A senha deve conter letras e números."})
    return password


def validate_login_payload(payload: dict) -> tuple[str, str]:
    errors: dict[str, str] = {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    if not email:
        errors["email"] = "Informe o e-mail."
    if not password:
        errors["password"] = "Informe a senha."
    if errors:
        raise ValidationError(errors)
    return email, password
