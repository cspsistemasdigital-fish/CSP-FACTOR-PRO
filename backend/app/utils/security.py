"""Authentication / authorization decorators and login throttling."""
from __future__ import annotations

import secrets
import time
from collections import defaultdict, deque
from functools import wraps

from flask import current_app, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from ..extensions import db
from ..models import Role, User

# --------------------------------------------------------------------------
# Login throttling.
#
# The default store is in-memory (single process). When RATE_LIMIT_STORAGE_URL
# points to Redis, attempts are shared between instances using a sliding-window
# sorted set. Any Redis failure falls back to memory so authentication is never
# blocked by an unavailable cache.
# --------------------------------------------------------------------------
_attempts: dict[str, deque] = defaultdict(deque)
_clients: dict[str, object | None] = {}


def _throttle_key(email: str) -> str:
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    return f"{email.lower()}|{ip}"


def _redis_key(email: str) -> str:
    return f"fp:login:{_throttle_key(email)}"


def _client_for(url: str):
    if url in _clients:
        return _clients[url]
    try:
        import redis  # optional dependency, configured for production

        client = redis.Redis.from_url(
            url, socket_connect_timeout=1, socket_timeout=1, decode_responses=True
        )
        client.ping()
        _clients[url] = client
    except Exception:  # noqa: BLE001 - fallback is intentional
        current_app.logger.warning(
            "RATE_LIMIT_STORAGE_URL indisponível; usando throttling em memória."
        )
        _clients[url] = None
    return _clients[url]


def _store():
    url = current_app.config.get("RATE_LIMIT_STORAGE_URL")
    if not url:
        return None
    return _client_for(url)


def _max_attempts() -> int:
    return int(current_app.config.get("LOGIN_MAX_ATTEMPTS") or 0)


def _window_seconds() -> int:
    return int(current_app.config.get("LOGIN_WINDOW_SECONDS") or 300)


def _memory_bucket(email: str) -> deque:
    window = _window_seconds()
    now = time.time()
    bucket = _attempts[_throttle_key(email)]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    return bucket


def login_is_blocked(email: str) -> bool:
    limit = _max_attempts()
    if not limit:
        return False
    store = _store()
    if store is not None:
        try:
            key = _redis_key(email)
            now = time.time()
            store.zremrangebyscore(key, 0, now - _window_seconds())
            return int(store.zcard(key)) >= limit
        except Exception:  # noqa: BLE001 - fall back to memory
            current_app.logger.warning("Falha ao consultar o Redis; usando memória.")
    return len(_memory_bucket(email)) >= limit


def register_login_failure(email: str) -> None:
    store = _store()
    if store is not None:
        try:
            now = time.time()
            key = _redis_key(email)
            member = f"{now}:{secrets.token_hex(4)}"
            store.zadd(key, {member: now})
            store.zremrangebyscore(key, 0, now - _window_seconds())
            store.expire(key, _window_seconds() + 1)
            return
        except Exception:  # noqa: BLE001 - fall back to memory
            current_app.logger.warning("Falha ao gravar no Redis; usando memória.")
    _attempts[_throttle_key(email)].append(time.time())


def clear_login_failures(email: str) -> None:
    store = _store()
    if store is not None:
        try:
            store.delete(_redis_key(email))
        except Exception:  # noqa: BLE001 - memory cleanup still happens below
            current_app.logger.warning("Falha ao limpar o Redis; usando memória.")
    _attempts.pop(_throttle_key(email), None)


def reset_throttle() -> None:  # used by tests
    _attempts.clear()


def throttle_backend() -> str:
    """Return the active store name (used by health/diagnostics in tests)."""
    return "redis" if _store() is not None else "memory"


def auth_required(*roles: str):
    """Require a valid access token and, optionally, one of the given roles."""

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            identity = get_jwt_identity()
            try:
                user_id = int(identity)
            except (TypeError, ValueError):
                return jsonify({"message": "Sessão inválida."}), 401

            user = db.session.get(User, user_id)
            if not user:
                return jsonify({"message": "Usuário não encontrado."}), 401
            if not user.is_active:
                return jsonify({"message": "Usuário inativo. Procure o administrador."}), 403
            if roles and user.role not in roles:
                return jsonify({"message": "Você não possui permissão para esta ação."}), 403

            g.current_user = user
            return view(*args, **kwargs)

        return wrapper

    return decorator


def current_user() -> User | None:
    return g.get("current_user")


def can_write() -> bool:
    user = current_user()
    return bool(user and user.role in (Role.ADMIN, Role.OPERATOR))
