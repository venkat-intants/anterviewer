"""LocalAuthProvider — email + bcrypt + JWT + Redis refresh tokens.

bcrypt is CPU-bound (sync). All bcrypt calls are wrapped in asyncio.to_thread()
to avoid blocking the event loop.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from collections.abc import AsyncGenerator, Callable
from typing import Any

import bcrypt
import structlog
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth.base import AuthProvider, AuthTokens, User
from shared.auth.jwt import (
    ACCESS_TOKEN_TTL_SECONDS,
    generate_refresh_token,
    hash_refresh_token,
    issue_access_token,
)

log = structlog.get_logger(__name__)

# Redis key prefix for refresh tokens
_RT_PREFIX = "refresh:"

# ---------------------------------------------------------------------------
# Timing-oracle mitigation (Security finding: HIGH — user enumeration)
#
# When a login attempt uses an unknown email we must still spend ~250ms doing
# a bcrypt comparison so that an attacker cannot distinguish "email not found"
# from "wrong password" by measuring response time.  We pre-compute a dummy
# hash once at import time (gensalt is expensive; hashpw is the cheap half),
# then call checkpw against it on the unknown-email path via asyncio.to_thread.
# ---------------------------------------------------------------------------
_DUMMY_BCRYPT_HASH: bytes = bcrypt.hashpw(
    b"dummy_password_for_timing_oracle_mitigation", bcrypt.gensalt(12)
)


def _hash_email(email: str) -> str:
    """Return first 16 hex chars of SHA-256(email) for safe log correlation.

    Never log raw email addresses — DPDP §8 treats email as PII.
    """
    return hashlib.sha256(email.encode()).hexdigest()[:16]


class LocalAuthProvider(AuthProvider):
    """Concrete AuthProvider that stores credentials in Postgres and tokens in Redis."""

    def __init__(
        self,
        db_session_factory: Callable[[], AsyncGenerator[AsyncSession, None]],
        redis_client: Redis,
        settings: Any,
    ) -> None:
        self._db_factory = db_session_factory
        self._redis = redis_client
        self._settings = settings

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _issue_tokens(
        self,
        user_id: str,
        roles: list[str],
    ) -> AuthTokens:
        """Issue access + refresh token pair, store refresh token in Redis."""
        access = issue_access_token(
            user_id=user_id,
            roles=roles,
            secret=self._settings.jwt_secret,
            algorithm=self._settings.jwt_algorithm,
            issuer=getattr(self._settings, "jwt_issuer", "intants-data-gateway"),
            audience=getattr(self._settings, "jwt_audience", "intants-services"),
        )
        raw_refresh = generate_refresh_token()
        refresh_key = _RT_PREFIX + hash_refresh_token(raw_refresh)
        ttl_seconds = self._settings.jwt_refresh_expiry_days * 86400
        await self._redis.setex(refresh_key, ttl_seconds, user_id)

        log.debug("auth.tokens_issued", user_id=user_id, roles=roles)
        return AuthTokens(
            access_token=access,
            refresh_token=raw_refresh,
            expires_in=ACCESS_TOKEN_TTL_SECONDS,
            user_id=user_id,
            roles=roles,
        )

    async def _get_roles_for_user(self, session: AsyncSession, user_id: str) -> list[str]:
        result = await session.execute(
            text(
                "SELECT r.name FROM roles r "
                "JOIN user_roles ur ON r.id = ur.role_id "
                "WHERE ur.user_id = :uid"
            ),
            {"uid": user_id},
        )
        return [str(row[0]) for row in result.fetchall()]

    async def _hash_password(self, password: str) -> str:
        rounds: int = self._settings.password_hash_rounds
        return await asyncio.to_thread(
            lambda: bcrypt.hashpw(
                password.encode(), bcrypt.gensalt(rounds=rounds)
            ).decode()
        )

    async def _verify_password(self, plain: str, hashed: str) -> bool:
        result: bool = await asyncio.to_thread(
            lambda: bcrypt.checkpw(plain.encode(), hashed.encode())
        )
        return result

    # ------------------------------------------------------------------
    # AuthProvider implementation
    # ------------------------------------------------------------------

    async def register(self, email: str, password: str, full_name: str) -> AuthTokens:
        """Create new user, assign 'candidate' role, return tokens."""
        password_hash = await self._hash_password(password)
        user_id = str(uuid.uuid4())

        async for session in self._db_factory():
            try:
                await session.execute(
                    text(
                        "INSERT INTO users (id, email, password_hash, full_name) "
                        "VALUES (:id, :email, :pw, :fn)"
                    ),
                    {
                        "id": user_id,
                        "email": email,
                        "pw": password_hash,
                        "fn": full_name,
                    },
                )
                await session.execute(
                    text(
                        "INSERT INTO user_roles (user_id, role_id) "
                        "VALUES (:uid, (SELECT id FROM roles WHERE name = 'candidate'))"
                    ),
                    {"uid": user_id},
                )
                await session.commit()
                # Log email_hash only — never raw PII (DPDP §8)
                log.info("auth.register", user_id=user_id, email_hash=_hash_email(email))
                return await self._issue_tokens(user_id, ["candidate"])
            except IntegrityError as exc:
                await session.rollback()
                log.warning(
                    "auth.register.duplicate_email", email_hash=_hash_email(email)
                )
                raise ValueError("email already exists") from exc
        # Should never reach here — db_factory always yields exactly one session
        raise RuntimeError("db_factory yielded no session")  # pragma: no cover

    async def authenticate(self, email: str, password: str) -> AuthTokens:
        """Verify email/password, return tokens."""
        row: Any = None
        async for session in self._db_factory():
            result = await session.execute(
                text(
                    "SELECT id, password_hash FROM users "
                    "WHERE email = :email AND deleted_at IS NULL AND is_active = true"
                ),
                {"email": email},
            )
            row = result.fetchone()

        if row is None:
            # Timing-oracle mitigation: run a dummy bcrypt comparison so that
            # unknown-email responses take the same ~250 ms as known-email
            # wrong-password responses.  Without this, response-time difference
            # leaks whether an email is registered (user-enumeration attack).
            await asyncio.to_thread(
                lambda: bcrypt.checkpw(b"dummy", _DUMMY_BCRYPT_HASH)
            )
            log.warning("auth.login.not_found", email_hash=_hash_email(email))
            raise ValueError("invalid credentials")

        user_id_str = str(row[0])
        stored_hash: str | None = row[1]

        if stored_hash is None or not await self._verify_password(password, stored_hash):
            log.warning("auth.login.bad_password", user_id=user_id_str)
            raise ValueError("invalid credentials")

        roles: list[str] = []
        async for session in self._db_factory():
            roles = await self._get_roles_for_user(session, user_id_str)

        log.info("auth.login", user_id=user_id_str)
        return await self._issue_tokens(user_id_str, roles)

    async def refresh(self, refresh_token: str) -> AuthTokens:
        """Validate refresh token, rotate it, return new token pair."""
        key = _RT_PREFIX + hash_refresh_token(refresh_token)
        user_id_raw: str | None = await self._redis.get(key)

        if user_id_raw is None:
            log.warning("auth.refresh.invalid_token")
            raise ValueError("invalid or expired refresh token")

        user_id = str(user_id_raw)

        # Rotate: delete old token immediately
        await self._redis.delete(key)

        roles: list[str] = []
        async for session in self._db_factory():
            roles = await self._get_roles_for_user(session, user_id)

        log.info("auth.refresh", user_id=user_id)
        return await self._issue_tokens(user_id, roles)

    async def logout(
        self,
        *,
        access_token: str | None = None,
        refresh_token: str | None = None,
        current_user_id: str | None = None,
    ) -> None:
        """Invalidate refresh token from Redis (access token expires naturally).

        When ``current_user_id`` is provided, the Redis key is looked up first
        to confirm ownership.  If the stored user_id does not match the caller's
        user_id the delete is skipped to prevent a user from invalidating another
        user's session (confused-deputy / cross-user logout attack).
        """
        if refresh_token is not None:
            key = _RT_PREFIX + hash_refresh_token(refresh_token)
            if current_user_id is not None:
                stored_raw: str | None = await self._redis.get(key)
                if stored_raw is None:
                    # Token already expired or revoked — treat as no-op.
                    log.info("auth.logout.token_not_found", user_id=current_user_id)
                    return
                stored_uid = str(stored_raw)
                if stored_uid != current_user_id:
                    log.warning(
                        "auth.logout.cross_user_rejected",
                        caller_user_id=current_user_id,
                        token_owner_user_id=stored_uid,
                    )
                    return  # Do NOT delete another user's token.
            deleted = await self._redis.delete(key)
            log.info("auth.logout", refresh_deleted=bool(deleted))
        # access_token: no denylist in Sprint 1 — 15 min TTL is the mitigation.
        # S1-007 security review is aware of this trade-off.

    async def get_user(self, user_id: str) -> User:
        """Return user profile by ID."""
        row: Any = None
        roles: list[str] = []
        async for session in self._db_factory():
            result = await session.execute(
                text(
                    "SELECT id, full_name, email FROM users "
                    "WHERE id = :uid AND deleted_at IS NULL AND is_active = true"
                ),
                {"uid": user_id},
            )
            row = result.fetchone()
            if row is None:
                raise ValueError(f"user {user_id!r} not found")
            roles = await self._get_roles_for_user(session, user_id)

        if row is None:  # db_factory yielded nothing (should not happen)
            raise ValueError(f"user {user_id!r} not found")  # pragma: no cover

        return User(
            user_id=str(row[0]),
            full_name=str(row[1]) if row[1] is not None else "",
            email=str(row[2]),
            roles=roles,
        )
