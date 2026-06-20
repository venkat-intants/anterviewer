"""FastAPI dependency providers for data_gateway."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated

import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from shared.auth.base import AuthProvider, User
from shared.auth.jwt import verify_access_token

from app.config import settings

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Auth provider singleton — set at startup by main.py
# ---------------------------------------------------------------------------
_auth_provider: AuthProvider | None = None

_bearer_scheme = HTTPBearer(auto_error=False)


def set_auth_provider(provider: AuthProvider) -> None:
    """Called once at startup to inject the provider."""
    global _auth_provider
    _auth_provider = provider


async def get_auth_provider_dep() -> AuthProvider:
    """FastAPI async dependency — returns the singleton AuthProvider."""
    if _auth_provider is None:
        raise RuntimeError("AuthProvider not initialised. Check startup hook.")
    return _auth_provider


# ---------------------------------------------------------------------------
# get_current_user dependency
# ---------------------------------------------------------------------------
_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing access token",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer_scheme),
    ],
) -> User:
    """Extract Bearer token, verify JWT, return User.

    Raises HTTP 401 if token is missing, malformed, or expired.
    """
    if credentials is None:
        raise _UNAUTHORIZED

    try:
        payload = verify_access_token(
            credentials.credentials,
            secret=settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
            expected_issuer=settings.jwt_issuer,
            expected_audience=settings.jwt_audience,
        )
    except JWTError as exc:
        log.warning("auth.jwt_verification_failed", error=str(exc))
        raise _UNAUTHORIZED from exc

    user_id: str | None = payload.get("sub")
    roles: list[str] = payload.get("roles", [])

    if not user_id:
        raise _UNAUTHORIZED

    return User(
        user_id=user_id,
        full_name="",  # JWT carries only sub + roles; /auth/me fetches full profile
        email="",
        roles=roles,
    )


# ---------------------------------------------------------------------------
# Role-based access control (HR workflow — Phase 0)
# ---------------------------------------------------------------------------


def require_role(*allowed: str) -> Callable[[User], Awaitable[User]]:
    """Dependency factory: require the caller to hold at least one of *allowed* roles.

    Usage:
        SuperAdminDep = Annotated[User, Depends(require_role("super_admin"))]
        @router.post(..., dependencies=[Depends(require_role("super_admin"))])
    """

    async def _dep(user: Annotated[User, Depends(get_current_user)]) -> User:
        if not set(allowed) & set(user.roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action.",
            )
        return user

    return _dep
