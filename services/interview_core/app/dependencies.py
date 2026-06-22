"""FastAPI dependency providers for interview_core.

interview_core does not manage user state — it only validates JWTs issued by
data_gateway and extracts the subject + roles for downstream use.
"""

from __future__ import annotations

from typing import Annotated, Any, cast

import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from shared.auth.jwt import verify_access_token

from app.config import settings

log = structlog.get_logger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing token",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer_scheme),
    ],
) -> dict[str, Any]:
    """Extract Bearer token, verify JWT, return decoded payload dict.

    Raises HTTP 401 if the token is absent, malformed, or expired.
    """
    if credentials is None:
        raise _UNAUTHORIZED

    try:
        raw = verify_access_token(
            credentials.credentials,
            secret=settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
            expected_issuer=settings.jwt_issuer,
            expected_audience=settings.jwt_audience,
        )
        payload: dict[str, Any] = cast(dict[str, Any], raw)
    except JWTError as exc:
        log.warning("auth.jwt_verification_failed", error=str(exc))
        raise _UNAUTHORIZED from exc

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise _UNAUTHORIZED

    return payload


CurrentUserDep = Annotated[dict[str, Any], Depends(get_current_user)]


async def get_non_guest_user(current_user: CurrentUserDep) -> dict[str, Any]:
    """Reject a token whose ONLY role is ``guest_candidate`` (Phase 3, B7).

    A magic-link interview guest is bound to exactly one pre-created session; it
    must never be able to self-mint or list sessions (which would let a leaked
    guest token amplify cost / enumerate other sessions). Any token carrying a
    real role alongside guest_candidate (shouldn't happen) still passes.
    """
    roles = current_user.get("roles") or []
    if "guest_candidate" in roles and not (set(roles) - {"guest_candidate"}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guest interview tokens cannot create or list sessions.",
        )
    return current_user


NonGuestUserDep = Annotated[dict[str, Any], Depends(get_non_guest_user)]
