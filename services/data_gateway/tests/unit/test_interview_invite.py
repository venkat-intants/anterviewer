"""Unit tests for the interview-invite redeem guard + HR validation (HR Phase 3).

The full provision-and-grade flow is covered by a live end-to-end smoke test; here
we lock the cheap, security-relevant guards: uniform 404 on bad/absent tokens and
input validation.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException


@pytest.mark.asyncio
async def test_preview_missing_token_404() -> None:
    from app.routers.interview_take import preview_invite

    with pytest.raises(HTTPException) as exc:
        await preview_invite(AsyncMock(), x_interview_token=None)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_redeem_missing_token_404() -> None:
    from app.routers.interview_take import RedeemIn, redeem_invite

    with pytest.raises(HTTPException) as exc:
        await redeem_invite(RedeemIn(consent_granted=True), AsyncMock(), x_interview_token=None)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_redeem_unknown_token_404() -> None:
    from app.routers.interview_take import RedeemIn, redeem_invite

    db = AsyncMock()
    db.scalar = AsyncMock(return_value=None)  # no invite resolves
    with pytest.raises(HTTPException) as exc:
        await redeem_invite(RedeemIn(consent_granted=True), db, x_interview_token="bogus-token")
    assert exc.value.status_code == 404


def test_invite_create_rejects_bad_language() -> None:
    from pydantic import ValidationError

    from app.routers.hr_interviews import InviteCreateIn

    with pytest.raises(ValidationError):
        InviteCreateIn(applicant_id=uuid.uuid4(), language="fr")


def test_invite_create_accepts_day1_languages() -> None:
    from app.routers.hr_interviews import InviteCreateIn

    for lang in ("en", "hi", "te"):
        m = InviteCreateIn(applicant_id=uuid.uuid4(), language=lang)
        assert m.language == lang
