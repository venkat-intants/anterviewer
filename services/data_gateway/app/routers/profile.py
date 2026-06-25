"""Read-only profile viewing for privileged roles.

  GET /users/{user_id}/profile  — HR managers, admins and super-admins can view
                                  any user's public profile (e.g. a candidate's).

This is the "click a candidate to see their details" surface. Editing one's own
profile lives in auth.py (PATCH /auth/me/profile); this router is view-only and
never returns secrets (no password hash, no resume text). Role-based access is
enforced by ``require_role`` — candidates cannot browse other users' profiles.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from shared.auth.base import User
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.dependencies import require_role

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/users", tags=["profiles"])

# HR managers, platform admins and super-admins may view any user's profile.
ViewerDep = Annotated[User, Depends(require_role("hr_manager", "admin", "super_admin"))]
DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]


class PublicProfile(BaseModel):
    """A user's viewable profile (no secrets — never PII like resume text)."""

    user_id: str
    full_name: str | None
    email: str | None
    roles: list[str]
    avatar_url: str | None = None
    headline: str | None = None
    bio: str | None = None
    employment_status: str | None = None
    desired_roles: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    location: str | None = None
    phone: str | None = None
    official_email: str | None = None
    has_resume: bool = False
    company_name: str | None = None
    created_at: datetime | None = None


@router.get(
    "/{user_id}/profile",
    status_code=status.HTTP_200_OK,
    response_model=PublicProfile,
    summary="View another user's profile (HR / admin / super-admin only)",
)
async def get_user_profile(
    user_id: uuid.UUID,
    _viewer: ViewerDep,
    db: DbSessionDep,
) -> PublicProfile:
    """Return the public profile of ``user_id``. 404 if missing / soft-deleted."""
    result = await db.execute(
        text(
            "SELECT u.full_name, u.email, u.avatar_url, u.headline, u.bio,"
            " u.employment_status, u.desired_roles, u.linkedin_url, u.github_url,"
            " u.location, u.phone, u.official_email, u.resume_s3_key, u.created_at,"
            " c.name AS company_name,"
            " COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles"
            " FROM users u"
            " LEFT JOIN companies c ON c.id = u.company_id"
            " LEFT JOIN user_roles ur ON ur.user_id = u.id"
            " LEFT JOIN roles r ON r.id = ur.role_id"
            " WHERE u.id = :uid AND u.deleted_at IS NULL"
            " GROUP BY u.id, c.name"
        ),
        {"uid": user_id},
    )
    row = result.fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    log.info("profile.view", target=str(user_id))
    return PublicProfile(
        user_id=str(user_id),
        full_name=row[0],
        email=row[1],
        avatar_url=row[2],
        headline=row[3],
        bio=row[4],
        employment_status=row[5],
        desired_roles=row[6],
        linkedin_url=row[7],
        github_url=row[8],
        location=row[9],
        phone=row[10],
        official_email=row[11],
        has_resume=bool(row[12]),
        created_at=row[13],
        company_name=row[14],
        roles=list(row[15] or []),
    )
