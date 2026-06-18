"""DPDP right-to-erasure endpoint — S5-004.

DPDP Act 2023, §17: every data principal has the right to erasure of their
personal data. This endpoint initiates a soft-delete of the user's account
and sessions, then schedules full erasure 30 days out.

Contract:
  POST /admin/users/{user_id}/dpdp/delete
    Auth:    admin JWT required (verify_admin_role dependency from main.py)
    Body:    optional {"reason": str}
    Returns: 202 {"request_id": str, "user_id": str, "scheduled_completion": str}

  Error paths:
    401 — no / invalid JWT           (from verify_admin_role)
    403 — valid JWT, non-admin role   (from verify_admin_role)
    404 — user_id not found in DB
    409 — pending erasure request already exists for this user
    500 — unexpected DB error (generic message; full exc logged, no PII)

PII safety:
  - user email / name / phone are NEVER logged.
  - Only user_id and request_id appear in log events.

security-auditor sign-off required before this endpoint goes to production.
"""

from __future__ import annotations

import uuid as _uuid_mod
from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_auth import AdminDep
from app.database import get_db_session
from app.models import AuditLog, ErasureRequest, Session, User

log = structlog.get_logger(__name__)

router = APIRouter(tags=["dpdp-erasure"])

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

_ERASURE_SCHEDULE_DAYS = 30


class ErasureRequestBody(BaseModel):
    """Optional request body for the DPDP erasure endpoint."""

    reason: str | None = None


class ErasureResponse(BaseModel):
    """202 Accepted response for a DPDP erasure request."""

    request_id: str
    user_id: str
    scheduled_completion: str


# ---------------------------------------------------------------------------
# Dependency shortcut
# ---------------------------------------------------------------------------

DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/users/{user_id}/dpdp/delete",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ErasureResponse,
    summary="Initiate DPDP right-to-erasure for a user (S5-004)",
    description=(
        "Soft-deletes the user account and their interview sessions, "
        "creates an erasure_requests record (status='pending'), "
        "and writes an audit_log entry. "
        "Full data purge is scheduled 30 days from the request date. "
        "Idempotency: returns 409 if a pending erasure request already exists."
    ),
)
async def request_erasure(
    user_id: _uuid_mod.UUID,
    admin_sub: AdminDep,
    db: DbSessionDep,
    body: ErasureRequestBody | None = None,
) -> ErasureResponse:
    """Initiate DPDP §17 right-to-erasure for *user_id*.

    All DB writes happen inside a single transaction; any failure rolls back
    the entire operation atomically.

    PII note: email/name/phone are NOT logged at any point in this function.
    """
    reason: str | None = body.reason if body is not None else None

    # ------------------------------------------------------------------
    # 1. Check user exists
    # ------------------------------------------------------------------
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        log.info("erasure.user_not_found", user_id=str(user_id))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )

    # ------------------------------------------------------------------
    # 2. Check for duplicate pending erasure request
    # ------------------------------------------------------------------
    existing_result = await db.execute(
        select(ErasureRequest).where(
            ErasureRequest.user_id == user_id,
            ErasureRequest.status == "pending",
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        log.info(
            "erasure.duplicate_request",
            user_id=str(user_id),
            existing_request_id=str(existing.request_id),
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A pending erasure request already exists for user {user_id}",
        )

    # ------------------------------------------------------------------
    # 3. Execute all writes in a single transaction
    # ------------------------------------------------------------------
    now_utc = datetime.now(UTC)
    scheduled_for = now_utc + timedelta(days=_ERASURE_SCHEDULE_DAYS)
    request_id = _uuid_mod.uuid4()

    try:
        # 3a. Soft-delete the user account
        user.deleted_at = now_utc

        # 3b. Soft-delete all sessions for this user
        #     Session.deleted_at was added by migration 20260529_0001.
        #     Use UPDATE ... WHERE to avoid loading all session rows.
        sessions_result = await db.execute(
            select(Session).where(
                Session.user_id == user_id,
                Session.deleted_at.is_(None),
            )
        )
        sessions = sessions_result.scalars().all()
        if sessions:
            await db.execute(
                update(Session)
                .where(
                    Session.user_id == user_id,
                    Session.deleted_at.is_(None),
                )
                .values(deleted_at=now_utc)
            )
            log.info(
                "erasure.sessions_soft_deleted",
                user_id=str(user_id),
                count=len(sessions),
            )
        else:
            log.info("erasure.no_sessions_to_delete", user_id=str(user_id))

        # 3c. Insert erasure_requests row
        erasure_row = ErasureRequest(
            request_id=request_id,
            user_id=user_id,
            requested_by=_uuid_mod.UUID(admin_sub) if admin_sub else _uuid_mod.uuid4(),
            reason=reason,
            status="pending",
            scheduled_for=scheduled_for,
            completed_at=None,
            artifacts=None,
            created_at=now_utc,
        )
        db.add(erasure_row)

        # 3d. Insert audit_log row — action only, no PII
        audit_row = AuditLog(
            actor_id=_uuid_mod.UUID(admin_sub) if admin_sub else None,
            actor_type="admin",
            action="dpdp_erasure_requested",
            resource_type="user",
            resource_id=user_id,
            details={"request_id": str(request_id)},
            ip_address=None,
            user_agent=None,
            event_ts=now_utc,
        )
        db.add(audit_row)

        await db.commit()

    except IntegrityError as exc:
        # Partial unique index uq_erasure_requests_pending fires when two
        # concurrent requests race past the explicit pre-check — DB-level guard.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A pending erasure request already exists for user {user_id}",
        ) from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        log.error(
            "erasure.db_error",
            user_id=str(user_id),
            exc_type=type(exc).__name__,
            exc_msg=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while processing the erasure request.",
        ) from exc

    log.info(
        "erasure.requested",
        user_id=str(user_id),
        request_id=str(request_id),
        scheduled_for=scheduled_for.isoformat(),
    )

    # ------------------------------------------------------------------
    # 4. Return 202 Accepted
    # ------------------------------------------------------------------
    return ErasureResponse(
        request_id=str(request_id),
        user_id=str(user_id),
        scheduled_completion=scheduled_for.isoformat(),
    )
