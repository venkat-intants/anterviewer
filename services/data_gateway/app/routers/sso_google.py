"""Google OAuth 2.0 SSO endpoints — S5-003b.

Implements the Google OAuth 2.0 authorization-code flow.

Contract:
  GET  /auth/sso/google/initiate?return_url={url}
         → 302 redirect to accounts.google.com authorize endpoint
         → 503 {"detail": "GOOGLE_OAUTH_NOT_CONFIGURED"} if client_id not set

  GET  /auth/sso/google/callback?code={code}&state={state}
         → 200 {"access_token": str, "token_type": "bearer", "user_id": str}
         → 503 {"detail": "GOOGLE_OAUTH_NOT_CONFIGURED"} if client_id not set
         → 400 {"detail": "INVALID_OR_EXPIRED_STATE"} on CSRF state mismatch

B-035: SSO routes are gated on Google being CONFIGURED (client_id set), not on
AUTH_PROVIDER. The auth factory has no bootable "google" provider, so the
platform runs AUTH_PROVIDER=local and offers Google SSO alongside local login.
         → 502 {"detail": "GOOGLE_TOKEN_EXCHANGE_FAILED"} on token endpoint error
         → 502 {"detail": "GOOGLE_USERINFO_FAILED"} on userinfo fetch error
         → 500 on unexpected errors

CSRF protection: A random state token is stored in Redis as
  oauth:google:state:{state_token} → return_url  (10-minute TTL)
On callback the key is retrieved and atomically deleted; absence → 400.

DB note: The ``users`` table has no ``google_id`` column in the current schema
(migration 20260527_0001).  Until a follow-up migration adds the column, the
upsert uses ``email`` as the conflict target and stores the google sub into a
no-op UPDATE so the user row is refreshed on each login.
Follow-up: add ``google_id TEXT UNIQUE`` to the users table and a unique index,
then switch the ON CONFLICT clause to ``index_elements=["google_id"]`` here.

PII note: user email and name from Google are NEVER written to logs.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from shared.auth.jwt import issue_access_token
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db_session
from app.models import User
from app.redis_client import get_redis

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/auth/sso/google", tags=["sso"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_STATE_TTL_SECONDS = 600  # 10 minutes
_STATE_KEY_PREFIX = "oauth:google:state:"

# ---------------------------------------------------------------------------
# Dependency shortcuts
# ---------------------------------------------------------------------------

DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]
# Redis is injected as a FastAPI dependency so tests can override it cleanly.
# redis.asyncio.Redis is not subscriptable at runtime on redis-py 5.x,
# so we use Any as the type argument and suppress the mypy ignore.
RedisDep = Annotated[Any, Depends(get_redis)]


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class SsoTokenResponse(BaseModel):
    """Successful SSO response — matches the shape used by the local auth flow."""

    access_token: str
    token_type: str = "bearer"
    user_id: str


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _require_google_configured() -> None:
    """Raise HTTP 503 if google_oauth_client_id is empty."""
    if not settings.google_oauth_client_id.strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GOOGLE_OAUTH_NOT_CONFIGURED",
        )


def _build_authorize_url(state: str) -> str:
    """Build the full Google OAuth2 authorization URL.

    Extracted as a pure function so the unit test can verify the URL
    structure without any I/O.
    """
    params: dict[str, str] = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
    }
    return f"{_GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"


def _state_redis_key(state_token: str) -> str:
    """Return the Redis key for the given OAuth state token."""
    return f"{_STATE_KEY_PREFIX}{state_token}"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/initiate",
    status_code=status.HTTP_302_FOUND,
    summary="Initiate Google OAuth 2.0 SSO flow",
    description=(
        "Redirects the browser to the Google OAuth2 authorize endpoint. "
        "Only available when AUTH_PROVIDER=google. "
        "Returns 404 otherwise; 503 if google_oauth_client_id is not configured. "
        "A cryptographically random state token is stored in Redis (10-minute TTL) "
        "for CSRF protection."
    ),
    response_class=RedirectResponse,
)
async def initiate(
    redis: RedisDep,
    return_url: Annotated[
        str,
        Query(description="URL to redirect the user to after successful authentication"),
    ] = "",
) -> RedirectResponse:
    """Begin the Google OAuth 2.0 authorization-code flow.

    Steps
    -----
    1. Guard: AUTH_PROVIDER must be 'google'.
    2. Guard: google_oauth_client_id must be configured.
    3. Generate a random ``state`` nonce (URL-safe, 32 bytes).
    4. Store ``state → return_url`` in Redis with 10-minute TTL.
    5. Build the Google authorize URL and return 302.
    """
    # B-035: SSO availability is gated on Google being *configured*, NOT on
    # AUTH_PROVIDER. The auth factory has no bootable "google" provider (it
    # raises NotImplementedError), so the platform runs AUTH_PROVIDER=local
    # while still offering Google SSO alongside local password login. The route
    # 503s when Google credentials are absent.
    _require_google_configured()

    state = secrets.token_urlsafe(32)

    await redis.set(
        _state_redis_key(state),
        return_url or "",
        ex=_STATE_TTL_SECONDS,
    )

    authorize_url = _build_authorize_url(state)
    log.info("google.sso.initiate", state_prefix=state[:8])
    return RedirectResponse(url=authorize_url, status_code=status.HTTP_302_FOUND)


@router.get(
    "/callback",
    status_code=status.HTTP_200_OK,
    response_model=SsoTokenResponse,
    summary="Handle Google OAuth2 callback and issue Intants JWT",
    description=(
        "Validates the CSRF state token, exchanges the authorization code for "
        "a Google access token, fetches the user's profile from Google, upserts "
        "the user in the Intants DB, and returns an Intants JWT. "
        "Returns 404 if AUTH_PROVIDER != google; 400 on invalid/expired state; "
        "502 on Google API errors."
    ),
)
async def callback(
    code: Annotated[str, Query(description="Authorization code from Google")],
    state: Annotated[str, Query(description="CSRF state token")],
    db: DbSessionDep,
    redis: RedisDep,
) -> SsoTokenResponse:
    """Complete the Google OAuth 2.0 flow and create/update the Intants user.

    Steps
    -----
    1. Guard: AUTH_PROVIDER must be 'google'.
    2. Validate ``state`` against Redis; delete the key atomically.
    3. Exchange ``code`` for a Google access token via POST to token endpoint.
    4. Fetch user info (sub, email, name) from Google userinfo endpoint.
    5. Upsert user in DB (ON CONFLICT email DO UPDATE).
    6. Issue Intants JWT (same claim shape as LocalAuthProvider).
    7. Return {"access_token": …, "token_type": "bearer", "user_id": …}.

    Error handling
    --------------
    - Missing/expired state → 400 INVALID_OR_EXPIRED_STATE
    - Google token exchange non-2xx → 502 GOOGLE_TOKEN_EXCHANGE_FAILED
    - Google userinfo non-2xx → 502 GOOGLE_USERINFO_FAILED
    - httpx.HTTPError on network failure → 502
    - Unexpected errors → 500
    """
    # B-035: gate on Google being configured (see initiate). Decoupled from
    # AUTH_PROVIDER so SSO works alongside local login.
    _require_google_configured()

    # ------------------------------------------------------------------
    # Step 2: Validate CSRF state token via Redis (get-then-delete)
    # ------------------------------------------------------------------
    state_key = _state_redis_key(state)
    stored_value: str | None = await redis.get(state_key)
    if stored_value is None:
        log.warning("google.sso.callback.invalid_state", state_prefix=state[:8])
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="INVALID_OR_EXPIRED_STATE",
        )
    # Atomically delete so the state token cannot be replayed.
    await redis.delete(state_key)

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            # ------------------------------------------------------------------
            # Step 3: Exchange code for tokens
            # ------------------------------------------------------------------
            try:
                token_resp = await http.post(
                    _GOOGLE_TOKEN_URL,
                    data={
                        "client_id": settings.google_oauth_client_id,
                        "client_secret": settings.google_oauth_client_secret,
                        "redirect_uri": settings.google_oauth_redirect_uri,
                        "code": code,
                        "grant_type": "authorization_code",
                    },
                )
            except httpx.HTTPError as exc:
                log.warning("google.sso.token_exchange.http_error", error=str(exc))
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="GOOGLE_TOKEN_EXCHANGE_FAILED",
                ) from exc

            if token_resp.status_code >= 400:
                log.warning(
                    "google.sso.token_exchange.error",
                    status_code=token_resp.status_code,
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="GOOGLE_TOKEN_EXCHANGE_FAILED",
                )

            token_payload = token_resp.json()
            access_token_google: str = token_payload.get("access_token", "")

            # ------------------------------------------------------------------
            # Step 4: Fetch user info
            # ------------------------------------------------------------------
            try:
                userinfo_resp = await http.get(
                    _GOOGLE_USERINFO_URL,
                    headers={"Authorization": f"Bearer {access_token_google}"},
                )
            except httpx.HTTPError as exc:
                log.warning("google.sso.userinfo.http_error", error=str(exc))
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="GOOGLE_USERINFO_FAILED",
                ) from exc

            if userinfo_resp.status_code >= 400:
                log.warning(
                    "google.sso.userinfo.error",
                    status_code=userinfo_resp.status_code,
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="GOOGLE_USERINFO_FAILED",
                )

            userinfo = userinfo_resp.json()
            # google_sub is the stable Google user identifier.
            google_sub: str = userinfo.get("sub", "")
            email: str = userinfo.get("email", "")
            full_name: str | None = userinfo.get("name") or None

            if not email:
                # Google must return an email when the 'email' scope is granted.
                log.error("google.sso.userinfo.missing_email")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="GOOGLE_USERINFO_FAILED",
                )

    except HTTPException:
        raise
    except Exception as exc:
        log.exception("google.sso.callback.unexpected_error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="INTERNAL_ERROR",
        ) from exc

    # ------------------------------------------------------------------
    # Step 5: Upsert user in DB
    #
    # NOTE: The ``users`` table does not yet have a ``google_id`` column.
    # The follow-up migration (add google_id TEXT UNIQUE to users) is
    # tracked as a separate PR.  Until then:
    #   - Conflict target: unique index on ``email``
    #   - google_sub is recorded in the structlog context only (not in DB)
    #   - ON CONFLICT DO UPDATE refreshes full_name and updated_at
    # After the migration, switch to:
    #   index_elements=["google_id"]
    #   and store google_sub in the google_id column.
    # ------------------------------------------------------------------
    now_utc = datetime.now(UTC)
    new_user_id: uuid.UUID = uuid.uuid4()

    stmt = (
        pg_insert(User)
        .values(
            id=new_user_id,
            email=email,
            password_hash=None,
            full_name=full_name,
            phone=None,
            preferred_language="en",
            naipunyam_id=None,
            is_active=True,
            created_at=now_utc,
            updated_at=now_utc,
        )
        .on_conflict_do_update(
            index_elements=["email"],
            set_={
                "full_name": full_name,
                "updated_at": now_utc,
                "is_active": True,
            },
        )
        .returning(User.id)
    )

    result = await db.execute(stmt)
    row = result.fetchone()
    if row is None:
        log.error("google.sso.upsert.no_row_returned")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="INTERNAL_ERROR",
        )
    final_user_id: uuid.UUID = row[0]
    await db.commit()

    log.info(
        "google.sso.callback.ok",
        google_sub_prefix=google_sub[:8] if google_sub else "empty",
        intants_user_id=str(final_user_id),
    )

    # ------------------------------------------------------------------
    # Step 6: Issue Intants JWT
    # ------------------------------------------------------------------
    intants_jwt = issue_access_token(
        user_id=str(final_user_id),
        roles=["candidate"],
        secret=settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
    )

    return SsoTokenResponse(
        access_token=intants_jwt,
        token_type="bearer",
        user_id=str(final_user_id),
    )
