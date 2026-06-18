"""Shared admin-JWT dependency for admin_ops.

Single authoritative implementation of the admin-role guard, imported by
every router that needs it.  Eliminates the duplicate copies that previously
lived in main.py (verify_admin_role) and erasure.py (_verify_admin_role).

Contract
--------
- Returns the ``sub`` claim (user_id string) from the JWT on success.
- Raises HTTP 401 if the Authorization header is absent or the token is
  invalid / expired.
- Raises HTTP 403 if the token is valid but the ``roles`` list does not
  contain ``"admin"``.

The platform issues a ``roles`` LIST claim, not a singular ``role`` string.
"""

from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from shared.auth.jwt import verify_access_token

from app.config import settings

log = structlog.get_logger(__name__)

_bearer = HTTPBearer(auto_error=False)


async def verify_admin_role(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> str:
    """FastAPI dependency — decodes the JWT and enforces role == 'admin'.

    Returns the user_id (sub claim) on success.
    Raises 401 if no/invalid token, 403 if valid but not admin.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = verify_access_token(
            credentials.credentials,
            settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
            expected_issuer=settings.jwt_issuer,
            expected_audience=settings.jwt_audience,
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    roles: list[str] = payload.get("roles") or []
    if "admin" not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    sub = str(payload.get("sub") or "")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub claim",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return sub


# Convenience type alias — use in endpoint signatures as the annotated dep.
AdminDep = Annotated[str, Depends(verify_admin_role)]
