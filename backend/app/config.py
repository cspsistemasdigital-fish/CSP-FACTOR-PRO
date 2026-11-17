"""Application configuration.

Environment driven. Development uses SQLite; production must use PostgreSQL.
"""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _database_uri() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///instance/factorpro.db")
    # Make relative SQLite paths deterministic (always inside the backend folder).
    if url.startswith("sqlite:///") and not url.startswith("sqlite:////"):
        relative = url.replace("sqlite:///", "", 1)
        candidate = (BASE_DIR / relative).resolve()
        return f"sqlite:///{candidate.as_posix()}"
    return url


class Config:
    # Core
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-insecure-secret")
    JSON_SORT_KEYS = False
    PROPAGATE_EXCEPTIONS = False

    # Database
    SQLALCHEMY_DATABASE_URI = _database_uri()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    # Auth / JWT
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-only-insecure-jwt-secret")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=int(os.getenv("JWT_ACCESS_TOKEN_MINUTES", "120")))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=int(os.getenv("JWT_REFRESH_TOKEN_DAYS", "7")))
    JWT_TOKEN_LOCATION = ["headers", "cookies"]
    JWT_COOKIE_SECURE = False          # overridden in production
    JWT_COOKIE_SAMESITE = "Lax"
    JWT_COOKIE_CSRF_PROTECT = False    # refresh cookie is httpOnly + SameSite=Lax
    JWT_REFRESH_COOKIE_PATH = "/api/auth"
    JWT_ACCESS_COOKIE_PATH = "/api"
    JWT_ERROR_MESSAGE_KEY = "message"

    # Uploads
    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "instance/uploads")
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024
    ALLOWED_UPLOAD_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "webp"}

    # Password recovery
    EXPOSE_RESET_TOKEN = _bool("EXPOSE_RESET_TOKEN", True)
    RESET_TOKEN_MINUTES = 30
    FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://127.0.0.1:5000").rstrip("/")

    # Transactional e-mail (password recovery). When MAIL_SERVER is empty the
    # system does not attempt delivery and only logs in development.
    MAIL_SERVER = os.getenv("MAIL_SERVER", "").strip()
    MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
    MAIL_USE_TLS = _bool("MAIL_USE_TLS", True)
    MAIL_USERNAME = os.getenv("MAIL_USERNAME", "").strip()
    MAIL_PASSWORD = os.getenv("MAIL_PASSWORD", "")
    MAIL_DEFAULT_SENDER = os.getenv("MAIL_DEFAULT_SENDER", "FACTOR PRO <no-reply@factorpro.com.br>")
    MAIL_TIMEOUT_SECONDS = int(os.getenv("MAIL_TIMEOUT_SECONDS", "10"))

    # CORS (development front-end)
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    ]

    # Login throttling
    LOGIN_MAX_ATTEMPTS = 6
    LOGIN_WINDOW_SECONDS = 300
    # Optional shared store for multi-instance deployments. Leave empty to use
    # the in-memory fallback (single process only).
    RATE_LIMIT_STORAGE_URL = os.getenv("RATE_LIMIT_STORAGE_URL", "").strip()

    # Password hashing (lower cost only in the testing profile)
    PASSWORD_HASH_METHOD = "pbkdf2:sha256:600000"

    # Seed administrator
    ADMIN_NAME = os.getenv("ADMIN_NAME", "Administrador")
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@factorpro.com.br")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Admin@12345")


class DevelopmentConfig(Config):
    DEBUG = True
    JWT_COOKIE_SECURE = False


class TestingConfig(Config):
    TESTING = True
    DEBUG = False
    SQLALCHEMY_DATABASE_URI = os.getenv("TEST_DATABASE_URL", "sqlite://")
    JWT_SECRET_KEY = "testing-jwt-secret-key-with-at-least-32-bytes"
    SECRET_KEY = "testing-secret-key-with-at-least-32-bytes"
    EXPOSE_RESET_TOKEN = True
    PASSWORD_HASH_METHOD = "pbkdf2:sha256:1000"
    LOGIN_MAX_ATTEMPTS = 100


class ProductionConfig(Config):
    DEBUG = False
    JWT_COOKIE_SECURE = True
    JWT_COOKIE_SAMESITE = "Strict"
    EXPOSE_RESET_TOKEN = False

    def __init__(self):
        if "sqlite" in self.SQLALCHEMY_DATABASE_URI:
            raise RuntimeError(
                "Production requires PostgreSQL. Configure DATABASE_URL with a "
                "postgresql+psycopg2:// connection string."
            )


CONFIG_MAP = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
}


def get_config(name: str | None = None):
    env = (name or os.getenv("FLASK_ENV") or "development").lower()
    return CONFIG_MAP.get(env, DevelopmentConfig)
