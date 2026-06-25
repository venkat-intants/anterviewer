"""Auth REST endpoints — S1-004 / B-033.

Contract (must match frontend mock at web/src/api/mock.ts):
  POST /auth/register    → 201 AuthTokensResponse | 409 | 400
  POST /auth/login       → 200 AuthTokensResponse | 401
  POST /auth/refresh     → 200 AuthTokensResponse | 401 | 403
  POST /auth/logout      → 200 {ok: true}         | 401
  GET  /auth/me          → 200 MeResponse         | 401
  PATCH /auth/me/profile → 200 MeResponse         | 401

Cookie scheme — two cookies are set on every login / register / refresh:

  1. ``refresh_token`` (name=AUTH_REFRESH_COOKIE_NAME, default "refresh_token")
     httponly=True  — JS cannot read it; XSS-safe.
     The browser sends it automatically with every credentialed request.

  2. ``csrf_token`` (name=AUTH_CSRF_COOKIE_NAME, default "csrf_token")
     httponly=False — JS *must* read it and echo it back.
     The browser also sends it automatically (same-site scope).

CSRF double-submit flow (for /auth/refresh when using cookies):
  a. On login/register/refresh: server sets both cookies; JS reads csrf_token.
  b. On the next /auth/refresh: JS sends "X-CSRF-Token: <value>" request header.
  c. Server reads the csrf_token cookie AND the X-CSRF-Token header, compares
     them with hmac.compare_digest.  Mismatch → 403 "CSRF validation failed."
  d. This protects against cross-site POST attacks (CSRF) even when
     SameSite=None is required for Vercel ↔ Railway cross-origin deployments,
     because a cross-site attacker can cause the browser to send the cookie but
     cannot read the cookie value (httponly=False but different origin), so it
     cannot supply the matching X-CSRF-Token header.
  e. When the refresh token is supplied via the request *body* instead of the
     cookie (non-browser / curl clients), the CSRF check is skipped — there is
     no ambient-cookie risk for programmatic clients that opt in explicitly.

Access token: Bearer header only — never in a cookie.
"""

from __future__ import annotations

import asyncio
import hmac
import secrets
import uuid
from typing import Annotated

import bcrypt
import structlog
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field
from shared.auth.base import AuthProvider, User
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db_session
from app.notifications_util import create_notification
from app.dependencies import get_auth_provider_dep, get_current_user
from app.rate_limit import rate_limit

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, description="Minimum 8 characters")
    full_name: str = Field(min_length=1)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class RefreshBody(BaseModel):
    # Optional so that cookie-only callers can omit the body entirely.
    # Non-browser / curl clients may still pass the token here; when they do
    # the CSRF header check is skipped (no ambient-cookie risk for explicit callers).
    refresh_token: str | None = None


class LogoutBody(BaseModel):
    # Optional fallback for non-browser clients that cannot use cookies.
    refresh_token: str | None = None


class AuthTokensResponse(BaseModel):
    """Returned by login / register / refresh.

    ``refresh_token`` is intentionally ABSENT from this model — it is delivered
    exclusively via the httpOnly cookie.  Returning it in JSON would let JS read
    it and negate the XSS protection of httponly=True.

    Non-browser clients that need the refresh token should read the
    Set-Cookie response header directly.
    """

    access_token: str
    expires_in: int
    user_id: str
    roles: list[str]


class MeResponse(BaseModel):
    user_id: str
    full_name: str
    email: str
    roles: list[str]
    # B-033 — candidate profile enrichment
    linkedin_url: str | None = None
    github_url: str | None = None
    # B-031 — whether the user has a resume on file (drives the upload UI state).
    # Boolean only — the resume text/key are PII and never returned here.
    has_resume: bool = False
    # HR workflow — true when the account still has its bootstrap password and
    # must reset it before doing anything else (drives the force-change redirect).
    must_change_password: bool = False
    # Editable self-service profile (candidate / HR / admin).
    phone: str | None = None
    preferred_language: str | None = None
    avatar_url: str | None = None
    headline: str | None = None
    bio: str | None = None
    employment_status: str | None = None
    desired_roles: str | None = None
    official_email: str | None = None
    location: str | None = None
    # Tenant context (read-only on the profile — HR's company is set by admins).
    company_id: str | None = None
    company_name: str | None = None


# Editable fields whitelist — column name → max length (None = unbounded text).
_PROFILE_EDITABLE: dict[str, int | None] = {
    "full_name": 120,
    "phone": 32,
    "preferred_language": 8,
    "linkedin_url": 300,
    "github_url": 300,
    "avatar_url": 800_000,  # downscaled data-URI (~tens of KB); generous ceiling
    "headline": 160,
    "bio": 2000,
    "employment_status": 16,
    "desired_roles": 300,
    "official_email": 254,
    "location": 120,
}

_EMPLOYMENT_STATUSES = {"student", "employed"}


class UserProfileUpdate(BaseModel):
    """Request body for PATCH /auth/me/profile.

    All fields optional — only provided fields are persisted. Covers the
    editable candidate / HR / admin profile surface.
    """

    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    preferred_language: str | None = Field(default=None, max_length=8)
    linkedin_url: str | None = Field(default=None, max_length=300)
    github_url: str | None = Field(default=None, max_length=300)
    avatar_url: str | None = Field(default=None, description="Data URI or image URL")
    headline: str | None = Field(default=None, max_length=160)
    bio: str | None = Field(default=None, max_length=2000)
    employment_status: str | None = Field(default=None, max_length=16)
    desired_roles: str | None = Field(default=None, max_length=300)
    official_email: str | None = Field(default=None, max_length=254)
    location: str | None = Field(default=None, max_length=120)


class OkResponse(BaseModel):
    ok: bool = True


# ---------------------------------------------------------------------------
# Dependency shortcuts
# ---------------------------------------------------------------------------
AuthProviderDep = Annotated[AuthProvider, Depends(get_auth_provider_dep)]
CurrentUserDep = Annotated[User, Depends(get_current_user)]
DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]


# ---------------------------------------------------------------------------
# Internal helpers — cookie management
# ---------------------------------------------------------------------------


def _set_refresh_cookie(response: Response, refresh_token: str, max_age: int) -> None:
    """Write the httpOnly refresh-token cookie onto *response*.

    Attributes
    ----------
    httponly=True  — JS cannot read the cookie value (XSS protection).
    secure         — AUTH_COOKIE_SECURE (False for localhost http; True in prod).
    samesite       — AUTH_COOKIE_SAMESITE ("lax" dev, "none" prod cross-site).
    domain         — AUTH_COOKIE_DOMAIN (None = scoped to request host).
    path           — AUTH_COOKIE_PATH (default "/").
    max_age        — refresh TTL in seconds (mirrors Redis TTL).
    """
    response.set_cookie(
        key=settings.auth_refresh_cookie_name,
        value=refresh_token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        domain=settings.auth_cookie_domain,
        path=settings.auth_cookie_path,
        max_age=max_age,
    )


def _set_csrf_cookie(response: Response, csrf_token: str, max_age: int) -> None:
    """Write the JS-readable CSRF token cookie onto *response*.

    httponly=False is intentional and required — JS must be able to read this
    cookie value so it can echo it back as the X-CSRF-Token request header.
    All other attributes mirror the refresh_token cookie (same scope).
    """
    response.set_cookie(
        key=settings.auth_csrf_cookie_name,
        value=csrf_token,
        httponly=False,  # Must be readable by JS for the double-submit pattern.
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        domain=settings.auth_cookie_domain,
        path=settings.auth_cookie_path,
        max_age=max_age,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Remove the refresh-token cookie by setting max_age=0."""
    response.delete_cookie(
        key=settings.auth_refresh_cookie_name,
        path=settings.auth_cookie_path,
        domain=settings.auth_cookie_domain,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        httponly=True,
    )


def _clear_csrf_cookie(response: Response) -> None:
    """Remove the CSRF token cookie by setting max_age=0."""
    response.delete_cookie(
        key=settings.auth_csrf_cookie_name,
        path=settings.auth_cookie_path,
        domain=settings.auth_cookie_domain,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        httponly=False,
    )


def _set_auth_cookies(response: Response, refresh_token: str, max_age: int) -> str:
    """Set both auth cookies and return the fresh CSRF token value.

    Sets:
      - httpOnly refresh_token cookie (XSS-safe, not readable by JS).
      - non-httpOnly csrf_token cookie (JS must read + echo as X-CSRF-Token header).

    Returns the csrf_token string so callers can log or use it if needed.
    """
    csrf_token = secrets.token_urlsafe(32)
    _set_refresh_cookie(response, refresh_token, max_age)
    _set_csrf_cookie(response, csrf_token, max_age)
    return csrf_token


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=AuthTokensResponse,
    summary="Register a new candidate account",
    dependencies=[rate_limit("auth", settings.rate_limit_login_per_minute)],
)
async def register(
    body: RegisterBody,
    auth: AuthProviderDep,
    response: Response,
    db: DbSessionDep,
) -> AuthTokensResponse:
    """Create a new user and return access token + auth cookies.

    Two cookies are set on the response:
      - ``refresh_token`` (httpOnly=True) — browser sends automatically.
      - ``csrf_token``    (httpOnly=False) — JS reads and echoes as X-CSRF-Token.

    The refresh token is NOT returned in the JSON body (security hardening:
    returning it in JSON would make it readable by JS and negate httpOnly).
    """
    try:
        tokens = await auth.register(
            email=body.email,
            password=body.password,
            full_name=body.full_name,
        )
    except ValueError as exc:
        msg = str(exc)
        if "already exists" in msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=msg,
        ) from exc

    refresh_ttl_seconds = settings.jwt_refresh_expiry_days * 86400
    _set_auth_cookies(response, tokens.refresh_token, max_age=refresh_ttl_seconds)

    # Seed a welcome notification (best-effort — never block signup on it).
    try:
        await create_notification(
            db,
            user_id=uuid.UUID(tokens.user_id),
            kind="welcome",
            title="Welcome to Anterview",
            body="Upload your resume and start a practice interview to get your first scorecard.",
            link="/dashboard",
        )
        await db.commit()
    except Exception:  # noqa: BLE001 — notification must never fail registration
        await db.rollback()

    return AuthTokensResponse(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        user_id=tokens.user_id,
        roles=tokens.roles,
    )


@router.post(
    "/login",
    status_code=status.HTTP_200_OK,
    response_model=AuthTokensResponse,
    summary="Authenticate with email + password",
    dependencies=[rate_limit("auth", settings.rate_limit_login_per_minute)],
)
async def login(
    body: LoginBody,
    auth: AuthProviderDep,
    response: Response,
) -> AuthTokensResponse:
    """Verify credentials and return access token + auth cookies.

    Two cookies are set on the response:
      - ``refresh_token`` (httpOnly=True) — browser sends automatically.
      - ``csrf_token``    (httpOnly=False) — JS reads and echoes as X-CSRF-Token.

    The refresh token is NOT returned in the JSON body.
    """
    try:
        tokens = await auth.authenticate(email=body.email, password=body.password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        ) from exc

    refresh_ttl_seconds = settings.jwt_refresh_expiry_days * 86400
    _set_auth_cookies(response, tokens.refresh_token, max_age=refresh_ttl_seconds)

    return AuthTokensResponse(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        user_id=tokens.user_id,
        roles=tokens.roles,
    )


@router.post(
    "/refresh",
    status_code=status.HTTP_200_OK,
    response_model=AuthTokensResponse,
    summary="Rotate refresh token and issue new access token",
)
async def refresh(
    auth: AuthProviderDep,
    response: Response,
    cookie_token: Annotated[str | None, Cookie(alias=settings.auth_refresh_cookie_name)] = None,
    cookie_csrf: Annotated[str | None, Cookie(alias=settings.auth_csrf_cookie_name)] = None,
    x_csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
    body: RefreshBody | None = None,
) -> AuthTokensResponse:
    """Exchange a valid refresh token for a new token pair (old token invalidated).

    Token source priority:
      1. httpOnly cookie (preferred — sent automatically by cookie-aware browsers).
         When using the cookie, the X-CSRF-Token header MUST match the csrf_token
         cookie value (double-submit CSRF protection).  Mismatch → 403.
      2. ``refresh_token`` in the JSON request body (fallback for curl / non-browser
         clients).  CSRF check is skipped for body-based tokens — there is no
         ambient-cookie risk when the caller supplies the token explicitly.

    If neither source provides a token → 401.
    After rotation both cookies (refresh_token + csrf_token) are rotated.

    # SECURITY TODO (prod-gate): TWO DEFERRED HARDENING ITEMS — do NOT remove this comment.
    # (a) Refresh-token reuse / lineage detection: on replay of an already-rotated
    #     token, revoke the entire token *family* (all tokens descended from the same
    #     original issuance) to invalidate a stolen-token scenario.  Requires storing
    #     a parent→child lineage graph in Redis alongside each token key.
    # (b) User→refresh-keys reverse index in Redis: maintain a SET at
    #     "user_sessions:<user_id>" containing all live refresh-token keys for that
    #     user so that DPDP §9 right-to-erasure can atomically purge all of a user's
    #     live sessions without a full Redis SCAN.  Also enables "log out all devices".
    """
    token_from_cookie = bool(cookie_token)
    raw_token: str | None = cookie_token or (body.refresh_token if body else None)

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is required (cookie or body).",
        )

    # CSRF double-submit check — applies ONLY when the token came from the cookie.
    # Programmatic clients that supply the token in the body skip this check.
    if token_from_cookie:
        if not x_csrf_token or not cookie_csrf:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed.",
            )
        if not hmac.compare_digest(x_csrf_token, cookie_csrf):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed.",
            )

    try:
        tokens = await auth.refresh(refresh_token=raw_token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is invalid or expired.",
        ) from exc

    refresh_ttl_seconds = settings.jwt_refresh_expiry_days * 86400
    _set_auth_cookies(response, tokens.refresh_token, max_age=refresh_ttl_seconds)

    return AuthTokensResponse(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        user_id=tokens.user_id,
        roles=tokens.roles,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    response_model=OkResponse,
    summary="Invalidate session tokens",
)
async def logout(
    auth: AuthProviderDep,
    current_user: CurrentUserDep,
    response: Response,
    cookie_token: Annotated[str | None, Cookie(alias=settings.auth_refresh_cookie_name)] = None,
    body: LogoutBody | None = None,
) -> OkResponse:
    """Invalidate the refresh token. Access token expires naturally (15 min TTL).

    Token source priority: cookie first, then body.  Idempotent — returns 200
    even if no token is provided or the token is already gone from Redis.
    Always clears both auth cookies (refresh_token + csrf_token) regardless of
    token validity.

    The refresh token being revoked is verified to belong to current_user to
    prevent a user from invalidating another user's session.
    """
    raw_token: str | None = cookie_token or (body.refresh_token if body else None)
    # Pass current_user_id so the provider can enforce ownership before deleting.
    await auth.logout(
        refresh_token=raw_token,
        current_user_id=current_user.user_id,
    )
    _clear_refresh_cookie(response)
    _clear_csrf_cookie(response)
    return OkResponse()


async def _build_me_response(db: object, user_id_str: str, user: object) -> MeResponse:
    """Assemble the full MeResponse: identity (from the auth provider) + the
    editable profile columns + read-only company context (single LEFT JOIN)."""
    result = await db.execute(  # type: ignore[attr-defined]
        text(
            "SELECT u.linkedin_url, u.github_url, u.resume_s3_key, u.must_change_password,"
            " u.phone, u.preferred_language, u.avatar_url, u.headline, u.bio,"
            " u.employment_status, u.desired_roles, u.official_email, u.location,"
            " u.company_id, c.name AS company_name"
            " FROM users u LEFT JOIN companies c ON c.id = u.company_id"
            " WHERE u.id = :uid"
        ),
        {"uid": uuid.UUID(user_id_str)},
    )
    row = result.fetchone()

    def g(i: int) -> object | None:
        return row[i] if row else None

    return MeResponse(
        user_id=user.user_id,  # type: ignore[attr-defined]
        full_name=user.full_name,  # type: ignore[attr-defined]
        email=user.email,  # type: ignore[attr-defined]
        roles=user.roles,  # type: ignore[attr-defined]
        linkedin_url=g(0),  # type: ignore[arg-type]
        github_url=g(1),  # type: ignore[arg-type]
        has_resume=bool(g(2)),
        must_change_password=bool(g(3)),
        phone=g(4),  # type: ignore[arg-type]
        preferred_language=g(5),  # type: ignore[arg-type]
        avatar_url=g(6),  # type: ignore[arg-type]
        headline=g(7),  # type: ignore[arg-type]
        bio=g(8),  # type: ignore[arg-type]
        employment_status=g(9),  # type: ignore[arg-type]
        desired_roles=g(10),  # type: ignore[arg-type]
        official_email=g(11),  # type: ignore[arg-type]
        location=g(12),  # type: ignore[arg-type]
        company_id=str(g(13)) if g(13) else None,
        company_name=g(14),  # type: ignore[arg-type]
    )


@router.get(
    "/me",
    status_code=status.HTTP_200_OK,
    response_model=MeResponse,
    summary="Get current user profile",
)
async def me(
    current_user: CurrentUserDep,
    auth: AuthProviderDep,
    db: DbSessionDep,
) -> MeResponse:
    """Return the full editable profile for the authenticated user."""
    try:
        user = await auth.get_user(current_user.user_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        ) from exc

    log.info("auth.me", user_id=current_user.user_id)
    return await _build_me_response(db, current_user.user_id, user)


@router.patch(
    "/me/profile",
    status_code=status.HTTP_200_OK,
    response_model=MeResponse,
    summary="Update current user profile",
)
async def update_profile(
    body: UserProfileUpdate,
    current_user: CurrentUserDep,
    auth: AuthProviderDep,
    db: DbSessionDep,
) -> MeResponse:
    """Partially update the authenticated user's profile.

    Only provided fields are written. An empty string clears a field (→ NULL).
    Covers the candidate / HR / admin editable surface.
    """
    updates: dict[str, object | None] = {}
    for col in _PROFILE_EDITABLE:
        val = getattr(body, col, None)
        if val is None:
            continue
        updates[col] = None if isinstance(val, str) and val == "" else val

    # Guards
    if updates.get("employment_status") not in (None, *_EMPLOYMENT_STATUSES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="employment_status must be 'student' or 'employed'.",
        )
    avatar = updates.get("avatar_url")
    if isinstance(avatar, str) and len(avatar) > 800_000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar image is too large — please use a smaller picture.",
        )

    if updates:
        set_clause = ", ".join(f"{col} = :{col}" for col in updates)
        params: dict[str, object | None] = {**updates, "uid": uuid.UUID(current_user.user_id)}
        await db.execute(
            text(f"UPDATE users SET {set_clause}, updated_at = now() WHERE id = :uid"),
            params,
        )
        await db.commit()
        log.info("auth.profile_updated", user_id=current_user.user_id, fields=list(updates))

    try:
        user = await auth.get_user(current_user.user_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        ) from exc

    return await _build_me_response(db, current_user.user_id, user)


class ChangePasswordBody(BaseModel):
    new_password: str = Field(min_length=8, description="New password (min 8 chars)")


@router.post(
    "/change-password",
    status_code=status.HTTP_200_OK,
    response_model=OkResponse,
    summary="Set a new password and clear the must-change flag",
)
async def change_password(
    body: ChangePasswordBody,
    current_user: CurrentUserDep,
    db: DbSessionDep,
) -> OkResponse:
    """Set the authenticated user's password and clear must_change_password.

    Used by HR managers (created with a bootstrap password) to set a real one on
    first login, but available to any authenticated user.
    """
    rounds: int = settings.password_hash_rounds
    new_hash = await asyncio.to_thread(
        lambda: bcrypt.hashpw(
            body.new_password.encode(), bcrypt.gensalt(rounds=rounds)
        ).decode()
    )
    await db.execute(
        text(
            "UPDATE users SET password_hash = :pw, must_change_password = false, "
            "updated_at = now() WHERE id = :uid"
        ),
        {"pw": new_hash, "uid": uuid.UUID(current_user.user_id)},
    )
    await db.commit()
    log.info("auth.password_changed", user_id=current_user.user_id)
    return OkResponse()
