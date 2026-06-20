"""Unit tests for super-admin HR management — HR workflow Phase 0.

DB is mocked so these run without infrastructure.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from shared.auth.base import User


def _super_admin() -> User:
    return User(user_id=str(uuid.uuid4()), full_name="Owner", email="a@b.c", roles=["super_admin"])


# ---------------------------------------------------------------------------
# require_role
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_require_role_allows_matching_role() -> None:
    from app.dependencies import require_role

    dep = require_role("super_admin")
    user = _super_admin()
    assert await dep(user) is user


@pytest.mark.asyncio
async def test_require_role_denies_missing_role() -> None:
    from app.dependencies import require_role

    dep = require_role("super_admin")
    hr = User(user_id="x", full_name="", email="", roles=["hr_manager"])
    with pytest.raises(HTTPException) as exc:
        await dep(hr)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_role_accepts_any_of_multiple() -> None:
    from app.dependencies import require_role

    dep = require_role("super_admin", "admin")
    user = User(user_id="x", full_name="", email="", roles=["admin"])
    assert await dep(user) is user


# ---------------------------------------------------------------------------
# create_company
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_company_slugifies_name() -> None:
    from app.routers.admin_hr import CreateCompanyBody, create_company

    db = AsyncMock()
    resp = await create_company(
        CreateCompanyBody(name="Acme College!"), _super_admin(), db
    )
    assert resp.name == "Acme College!"
    assert resp.slug == "acme-college"
    assert resp.hr_count == 0
    db.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# create_hr_manager
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_hr_manager_happy_path() -> None:
    from app.routers.admin_hr import CreateHrBody, create_hr_manager

    company_id = uuid.uuid4()
    db = AsyncMock()
    db.scalar = AsyncMock(return_value=1)  # company exists

    with patch("app.routers.admin_hr._hash_password", new=AsyncMock(return_value="hashed")):
        resp = await create_hr_manager(
            company_id,
            CreateHrBody(email="hr@gmail.com", full_name="HR", password="12345678"),
            _super_admin(),
            db,
        )

    assert resp.email == "hr@gmail.com"
    assert resp.company_id == str(company_id)
    assert resp.must_change_password is True
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_hr_manager_unknown_company_404() -> None:
    from app.routers.admin_hr import CreateHrBody, create_hr_manager

    db = AsyncMock()
    db.scalar = AsyncMock(return_value=None)  # company missing

    with pytest.raises(HTTPException) as exc:
        await create_hr_manager(
            uuid.uuid4(),
            CreateHrBody(email="hr@gmail.com", full_name="HR"),
            _super_admin(),
            db,
        )
    assert exc.value.status_code == 404
