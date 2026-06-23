"""Super-admin endpoints — HR workflow Phase 0.

Lets the platform owner (super_admin) manage tenant companies and the HR
managers inside them:

  POST   /admin/companies                        — create a company
  GET    /admin/companies                        — list companies
  POST   /admin/companies/{company_id}/hr-managers — create an HR manager
  GET    /admin/companies/{company_id}/hr-managers — list a company's HR managers

All routes require the ``super_admin`` role. HR managers are created with a
(default) password and ``must_change_password=true`` so they are forced to
reset it on first login.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from datetime import UTC, datetime
from typing import Annotated

import bcrypt
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from shared.auth.base import User
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db_session
from app.dependencies import require_role

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/admin", tags=["admin-hr"])

SuperAdminDep = Annotated[User, Depends(require_role("super_admin"))]
DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class CreateCompanyBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=80)


class CompanyResponse(BaseModel):
    id: str
    name: str
    slug: str
    is_active: bool
    hr_count: int = 0
    created_at: str


class CreateHrBody(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    # Default per product spec; the HR is forced to change it on first login.
    password: str = Field(default="12345678", min_length=8, max_length=128)


class HrManagerResponse(BaseModel):
    user_id: str
    email: str
    full_name: str
    company_id: str
    must_change_password: bool
    created_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "company"


async def _hash_password(password: str) -> str:
    rounds: int = settings.password_hash_rounds
    return await asyncio.to_thread(
        lambda: bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=rounds)).decode()
    )


async def _company_or_404(db: AsyncSession, company_id: uuid.UUID) -> None:
    exists = await db.scalar(
        text(
            "SELECT 1 FROM companies WHERE id = :cid AND deleted_at IS NULL"
        ),
        {"cid": company_id},
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found.",
        )


# ---------------------------------------------------------------------------
# Companies
# ---------------------------------------------------------------------------


@router.post("/companies", status_code=status.HTTP_201_CREATED, response_model=CompanyResponse)
async def create_company(
    body: CreateCompanyBody, current_user: SuperAdminDep, db: DbSessionDep
) -> CompanyResponse:
    """Create a tenant company (super_admin only)."""
    company_id = uuid.uuid4()
    slug = _slugify(body.slug or body.name)
    now = datetime.now(tz=UTC)
    try:
        await db.execute(
            text(
                "INSERT INTO companies "
                "(id, name, slug, created_by_user_id, created_at, updated_at) "
                "VALUES (:id, :name, :slug, :uid, :now, :now)"
            ),
            {
                "id": company_id,
                "name": body.name,
                "slug": slug,
                "uid": uuid.UUID(current_user.user_id),
                "now": now,
            },
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A company with slug '{slug}' already exists.",
        ) from exc
    log.info("admin_hr.company_created", company_id=str(company_id), slug=slug)
    return CompanyResponse(
        id=str(company_id), name=body.name, slug=slug, is_active=True, hr_count=0,
        created_at=now.isoformat(),
    )


@router.get("/companies", response_model=list[CompanyResponse])
async def list_companies(current_user: SuperAdminDep, db: DbSessionDep) -> list[CompanyResponse]:
    """List all active companies with their HR-manager counts (super_admin only)."""
    rows = (
        await db.execute(
            text(
                "SELECT c.id, c.name, c.slug, c.is_active, c.created_at, "
                "(SELECT count(*) FROM users u "
                " JOIN user_roles ur ON ur.user_id = u.id "
                " JOIN roles r ON r.id = ur.role_id AND r.name = 'hr_manager' "
                " WHERE u.company_id = c.id AND u.deleted_at IS NULL) AS hr_count "
                "FROM companies c WHERE c.deleted_at IS NULL "
                "ORDER BY c.created_at DESC"
            )
        )
    ).fetchall()
    return [
        CompanyResponse(
            id=str(r[0]), name=r[1], slug=r[2], is_active=r[3],
            created_at=r[4].isoformat(), hr_count=int(r[5]),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# HR managers
# ---------------------------------------------------------------------------


@router.post(
    "/companies/{company_id}/hr-managers",
    status_code=status.HTTP_201_CREATED,
    response_model=HrManagerResponse,
)
async def create_hr_manager(
    company_id: uuid.UUID, body: CreateHrBody, current_user: SuperAdminDep, db: DbSessionDep
) -> HrManagerResponse:
    """Create an HR manager scoped to a company (super_admin only).

    The HR is created with the given (default '12345678') password and
    must_change_password=true, forcing a reset on first login.
    """
    await _company_or_404(db, company_id)
    user_id = uuid.uuid4()
    now = datetime.now(tz=UTC)
    password_hash = await _hash_password(body.password)
    try:
        await db.execute(
            text(
                "INSERT INTO users "
                "(id, email, password_hash, full_name, company_id, "
                " must_change_password, created_at, updated_at) "
                "VALUES (:id, :email, :pw, :fn, :cid, true, :now, :now)"
            ),
            {
                "id": user_id, "email": str(body.email), "pw": password_hash,
                "fn": body.full_name, "cid": company_id, "now": now,
            },
        )
        await db.execute(
            text(
                "INSERT INTO user_roles (user_id, role_id) "
                "VALUES (:uid, (SELECT id FROM roles WHERE name = 'hr_manager'))"
            ),
            {"uid": user_id},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        ) from exc
    log.info("admin_hr.hr_created", user_id=str(user_id), company_id=str(company_id))
    return HrManagerResponse(
        user_id=str(user_id), email=str(body.email), full_name=body.full_name,
        company_id=str(company_id), must_change_password=True, created_at=now.isoformat(),
    )


@router.get(
    "/companies/{company_id}/hr-managers", response_model=list[HrManagerResponse]
)
async def list_hr_managers(
    company_id: uuid.UUID, current_user: SuperAdminDep, db: DbSessionDep
) -> list[HrManagerResponse]:
    """List a company's HR managers (super_admin only)."""
    await _company_or_404(db, company_id)
    rows = (
        await db.execute(
            text(
                "SELECT u.id, u.email, u.full_name, u.must_change_password, u.created_at "
                "FROM users u "
                "JOIN user_roles ur ON ur.user_id = u.id "
                "JOIN roles r ON r.id = ur.role_id AND r.name = 'hr_manager' "
                "WHERE u.company_id = :cid AND u.deleted_at IS NULL "
                "ORDER BY u.created_at DESC"
            ),
            {"cid": company_id},
        )
    ).fetchall()
    return [
        HrManagerResponse(
            user_id=str(r[0]), email=r[1], full_name=r[2] or "",
            company_id=str(company_id), must_change_password=r[3],
            created_at=r[4].isoformat(),
        )
        for r in rows
    ]
