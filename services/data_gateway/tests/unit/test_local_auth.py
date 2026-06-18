"""Unit tests for LocalAuthProvider — S1-003.

Uses in-memory fakes for DB and Redis so tests run without infrastructure.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Any

import pytest
from shared.auth.local import LocalAuthProvider

# ---------------------------------------------------------------------------
# Minimal settings stub
# ---------------------------------------------------------------------------


class _FakeSettings:
    jwt_secret: str = "testsecret-32-bytes-xxxxxxxxxxxx"
    jwt_algorithm: str = "HS256"
    jwt_refresh_expiry_days: int = 30
    password_hash_rounds: int = 4  # Low rounds for fast tests


# ---------------------------------------------------------------------------
# In-memory Redis fake
# ---------------------------------------------------------------------------


class _FakeRedis:
    """Minimal async Redis fake for tests."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[str, int]] = {}  # key → (value, ttl)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self._store[key] = (value, ttl)

    async def get(self, key: str) -> str | None:
        entry = self._store.get(key)
        return entry[0] if entry else None

    async def delete(self, key: str) -> int:
        if key in self._store:
            del self._store[key]
            return 1
        return 0


# ---------------------------------------------------------------------------
# In-memory DB fake — stores users and roles in dicts
# ---------------------------------------------------------------------------


class _FakeSession:
    """Records SQL calls and returns faked results."""

    def __init__(self, db: _FakeDB) -> None:
        self._db = db
        self._pending: list[tuple[str, dict[str, Any]]] = []

    async def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> Any:
        return self._db.execute(str(stmt), params or {})

    async def commit(self) -> None:
        for stmt, params in self._pending:
            self._db.apply(stmt, params)
        self._pending.clear()

    async def rollback(self) -> None:
        self._pending.clear()

    async def __aenter__(self) -> _FakeSession:
        return self

    async def __aexit__(self, *args: Any) -> None:
        pass


class _FakeResult:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    def scalar(self) -> Any:
        return self._rows[0][0] if self._rows else None


class _FakeDB:
    """Holds in-memory state mimicking the auth tables."""

    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        # roles seeded like the migration
        self.roles: dict[int, str] = {1: "candidate", 2: "admin"}
        self.user_roles: dict[str, list[int]] = {}
        self._raise_integrity: bool = False

    def execute(self, stmt: str, params: dict[str, Any]) -> _FakeResult:
        stmt_lower = stmt.lower()

        if "insert into users" in stmt_lower:
            uid = str(params.get("id", str(uuid.uuid4())))
            email = params["email"]
            if any(u["email"] == email for u in self.users.values()):
                from sqlalchemy.exc import IntegrityError

                raise IntegrityError("users_email_uq", {}, Exception("duplicate"))
            self.users[uid] = {
                "id": uid,
                "email": email,
                "password_hash": params["pw"],
                "full_name": params["fn"],
                "is_active": True,
                "deleted_at": None,
            }
            return _FakeResult([])

        if "insert into user_roles" in stmt_lower:
            uid = str(params["uid"])
            if uid not in self.user_roles:
                self.user_roles[uid] = []
            self.user_roles[uid].append(1)  # candidate role id=1
            return _FakeResult([])

        if "select id, password_hash from users" in stmt_lower:
            email = params["email"]
            for _uid, u in self.users.items():
                if u["email"] == email and u["is_active"] and u["deleted_at"] is None:
                    return _FakeResult([(u["id"], u["password_hash"])])
            return _FakeResult([])

        if "select id, full_name, email from users" in stmt_lower:
            uid = str(params["uid"])
            u = self.users.get(uid)
            if u:
                return _FakeResult([(u["id"], u["full_name"], u["email"])])
            return _FakeResult([])

        if "select r.name from roles" in stmt_lower:
            uid = str(params["uid"])
            role_ids = self.user_roles.get(uid, [])
            names = [(self.roles[rid],) for rid in role_ids if rid in self.roles]
            return _FakeResult(names)

        return _FakeResult([])

    def apply(self, stmt: str, params: dict[str, Any]) -> None:
        pass  # Inserts handled in execute() for simplicity


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_db() -> _FakeDB:
    return _FakeDB()


@pytest.fixture
def fake_redis() -> _FakeRedis:
    return _FakeRedis()


@pytest.fixture
def provider(fake_db: _FakeDB, fake_redis: _FakeRedis) -> LocalAuthProvider:
    async def session_factory() -> AsyncGenerator[_FakeSession, None]:  # type: ignore[misc]
        yield _FakeSession(fake_db)

    return LocalAuthProvider(
        db_session_factory=session_factory,  # type: ignore[arg-type]
        redis_client=fake_redis,  # type: ignore[arg-type]
        settings=_FakeSettings(),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_returns_tokens(provider: LocalAuthProvider) -> None:
    tokens = await provider.register("alice@example.com", "securepass", "Alice")
    assert tokens.access_token
    assert tokens.refresh_token
    assert tokens.expires_in == 900
    assert tokens.user_id
    assert "candidate" in tokens.roles


@pytest.mark.asyncio
async def test_authenticate_correct_password(provider: LocalAuthProvider) -> None:
    await provider.register("bob@example.com", "mypassword", "Bob")
    tokens = await provider.authenticate("bob@example.com", "mypassword")
    assert tokens.user_id
    assert "candidate" in tokens.roles


@pytest.mark.asyncio
async def test_authenticate_wrong_password(provider: LocalAuthProvider) -> None:
    await provider.register("carol@example.com", "rightpass", "Carol")
    with pytest.raises(ValueError, match="invalid credentials"):
        await provider.authenticate("carol@example.com", "wrongpass")


@pytest.mark.asyncio
async def test_authenticate_unknown_email(provider: LocalAuthProvider) -> None:
    with pytest.raises(ValueError, match="invalid credentials"):
        await provider.authenticate("nobody@example.com", "anypass")


@pytest.mark.asyncio
async def test_duplicate_email_raises(provider: LocalAuthProvider) -> None:
    await provider.register("dave@example.com", "pass1234", "Dave")
    with pytest.raises(ValueError, match="already exists"):
        await provider.register("dave@example.com", "pass5678", "Dave2")


@pytest.mark.asyncio
async def test_refresh_rotation(provider: LocalAuthProvider) -> None:
    tokens1 = await provider.register("eve@example.com", "passw0rd!", "Eve")
    tokens2 = await provider.refresh(tokens1.refresh_token)

    # New refresh token must differ from the old one
    assert tokens2.refresh_token != tokens1.refresh_token
    # user_id and roles preserved
    assert tokens2.user_id == tokens1.user_id
    assert tokens2.roles == tokens1.roles
    # New tokens are fully formed
    assert tokens2.access_token
    assert tokens2.expires_in == 900

    # Old refresh token must now be invalid (rotated out)
    with pytest.raises(ValueError, match="invalid or expired"):
        await provider.refresh(tokens1.refresh_token)


@pytest.mark.asyncio
async def test_logout_invalidates_refresh(provider: LocalAuthProvider) -> None:
    tokens = await provider.register("frank@example.com", "12345678", "Frank")
    await provider.logout(refresh_token=tokens.refresh_token)

    with pytest.raises(ValueError, match="invalid or expired"):
        await provider.refresh(tokens.refresh_token)


@pytest.mark.asyncio
async def test_get_user_returns_profile(provider: LocalAuthProvider) -> None:
    tokens = await provider.register("grace@example.com", "mypassw0rd", "Grace")
    user = await provider.get_user(tokens.user_id)
    assert user.email == "grace@example.com"
    assert user.full_name == "Grace"
    assert "candidate" in user.roles


@pytest.mark.asyncio
async def test_get_user_not_found(provider: LocalAuthProvider) -> None:
    with pytest.raises(ValueError, match="not found"):
        await provider.get_user(str(uuid.uuid4()))
