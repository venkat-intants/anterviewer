"""POST /internal/score — end-of-session scoring endpoint (S5-006).

Auth: JWT required (HS256, same jwt_secret as other services).
      No admin role required — this is an internal service-to-service call.

Idempotency: the scorecards table has a UNIQUE constraint on session_id.
             A second call for the same session_id returns HTTP 409.
"""

from __future__ import annotations

from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from pydantic import BaseModel, Field, field_validator
from shared.auth.jwt import verify_access_token
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.config import settings as _app_settings
from app.database import get_db_session
from app.scorer import ScoringError, score_session


def _get_settings() -> Settings:
    return _app_settings

log = structlog.get_logger(__name__)

router = APIRouter(tags=["internal"])

_bearer_scheme = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

_VALID_ROLES = {"ai", "user", "interviewer", "candidate"}


class TurnIn(BaseModel):
    """A single conversation turn in the transcript."""

    role: str = Field(..., description="Speaker role: 'ai' or 'user'")
    text: str = Field(..., description="Turn text content")

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str) -> str:
        if v not in _VALID_ROLES:
            raise ValueError(f"role must be one of {sorted(_VALID_ROLES)}")
        return v


class ScoreRequest(BaseModel):
    """Request body for POST /internal/score."""

    session_id: str = Field(..., description="UUID of the completed session")
    job_title: str = Field(..., min_length=1, description="Job title for calibration")
    experience_level: str = Field(
        ..., min_length=1, description="Experience tier, e.g. 'entry', 'mid', 'senior'"
    )
    language: str = Field(
        default="en",
        description="BCP-47 language code: 'en', 'hi', or 'te'",
    )
    jd_text: str = Field(
        default="", description="Parsed JD text — optional, improves scoring accuracy"
    )
    turns: list[TurnIn] = Field(
        ..., description="Ordered list of conversation turns"
    )


class ScoreResponse(BaseModel):
    """Response body for POST /internal/score (201 Created)."""

    scorecard_id: str
    composite_score: float
    scores: dict[str, int]


# ---------------------------------------------------------------------------
# JWT dependency
# ---------------------------------------------------------------------------

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing access token",
    headers={"WWW-Authenticate": "Bearer"},
)


async def _require_jwt(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer_scheme),
    ],
) -> dict[str, Any]:
    """Verify Bearer JWT; return decoded payload.

    Raises HTTP 401 on any auth failure. No role restriction — this is an
    internal endpoint; the JWT itself (signed by jwt_secret) proves the caller
    is a trusted internal service.
    """
    if credentials is None:
        raise _UNAUTHORIZED

    try:
        payload = verify_access_token(
            credentials.credentials,
            secret=_app_settings.jwt_secret,
            algorithm=_app_settings.jwt_algorithm,
            expected_issuer=_app_settings.jwt_issuer,
            expected_audience=_app_settings.jwt_audience,
        )
    except JWTError as exc:
        log.warning("score.auth.jwt_failed", error_type=type(exc).__name__)
        raise _UNAUTHORIZED from exc

    return payload


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/score",
    status_code=status.HTTP_201_CREATED,
    response_model=ScoreResponse,
    summary="Score a completed interview session",
    description=(
        "Renders the APSSDC scorer prompt, calls Gemini at temperature 0.2, "
        "and persists a scorecards row. Returns the scorecard_id and composite_score. "
        "Idempotency: a second call for the same session_id returns 409."
    ),
)
async def internal_score(
    body: ScoreRequest,
    _jwt_payload: Annotated[dict[str, Any], Depends(_require_jwt)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    app_settings: Annotated[Settings, Depends(_get_settings)],
) -> ScoreResponse:
    """Score a session and persist the scorecard.

    Returns:
        201 ScoreResponse on success.
        400 if the request body is invalid (handled by FastAPI Pydantic validation).
        401 if the JWT is missing or invalid.
        409 if a scorecard already exists for this session_id.
        502 if Gemini fails (ScoringError).
    """
    turns_dicts = [{"role": t.role, "text": t.text} for t in body.turns]

    try:
        scorecard_id, scores, composite = await score_session(
            session_id=body.session_id,
            job_title=body.job_title,
            experience_level=body.experience_level,
            language=body.language,
            jd_text=body.jd_text,
            turns=turns_dicts,
            db_session=db,
            settings=app_settings,
        )
    except ScoringError as exc:
        log.error(
            "score.gemini_error",
            session_id=body.session_id,
            error=exc.message,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Scoring failed: {exc.message}",
        ) from exc
    except IntegrityError as exc:
        # UNIQUE constraint on session_id — duplicate submission.
        log.warning(
            "score.duplicate_session",
            session_id=body.session_id,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Scorecard already exists for session_id {body.session_id!r}",
        ) from exc

    return ScoreResponse(
        scorecard_id=scorecard_id,
        composite_score=composite,
        scores=scores,
    )
