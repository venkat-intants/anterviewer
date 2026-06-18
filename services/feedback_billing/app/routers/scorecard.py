"""GET /scorecards/{scorecard_id} — scorecard retrieval endpoint (S5-007).

Auth: JWT required (same _require_jwt pattern as score.py).
Returns scorecard data including a 30-day pre-signed S3 URL for the PDF.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from pydantic import BaseModel, Field
from shared.auth.jwt import verify_access_token
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.config import settings as _app_settings
from app.database import get_db_session

log = structlog.get_logger(__name__)

router = APIRouter(tags=["scorecards"])

_bearer_scheme = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------------------
# Pydantic response model
# ---------------------------------------------------------------------------


class ScoreBreakdown(BaseModel):
    """Per-axis scores (0-10 each)."""

    communication: int = Field(..., ge=0, le=10)
    technical: int = Field(..., ge=0, le=10)
    problem_solving: int = Field(..., ge=0, le=10)
    confidence: int = Field(..., ge=0, le=10)


class AxisRationale(BaseModel):
    """Per-axis 'why this score' explanation. Empty strings for legacy rows."""

    communication: str = ""
    technical: str = ""
    problem_solving: str = ""
    confidence: str = ""


class ImprovementItem(BaseModel):
    """A single improvement recommendation."""

    area: str
    suggestion: str


class ScorecardResponse(BaseModel):
    """Response body for GET /scorecards/{scorecard_id}."""

    scorecard_id: str
    session_id: str
    composite_score: float
    scores: ScoreBreakdown
    rationale: AxisRationale = Field(
        default_factory=AxisRationale,
        description="Per-axis explanation of why each score was given.",
    )
    strengths: list[str]
    improvements: list[ImprovementItem]
    summary: str
    report_pdf_url: str | None = Field(
        default=None,
        description="30-day pre-signed S3 URL for the PDF report, or null if not yet generated.",
    )


# ---------------------------------------------------------------------------
# Auth dependency (shared pattern with score.py)
# ---------------------------------------------------------------------------

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing access token",
    headers={"WWW-Authenticate": "Bearer"},
)


def _get_settings() -> Settings:
    return _app_settings


async def _require_jwt(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer_scheme),
    ],
) -> dict[str, Any]:
    """Verify Bearer JWT; return decoded payload.

    Raises HTTP 401 on any auth failure.
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
        log.warning("scorecard.auth.jwt_failed", error_type=type(exc).__name__)
        raise _UNAUTHORIZED from exc

    return payload


# ---------------------------------------------------------------------------
# S3 pre-signed URL helper
# ---------------------------------------------------------------------------


async def _generate_presigned_url(
    s3_key: str,
    settings: Settings,
    expiry_seconds: int = 86400 * 30,
) -> str | None:
    """Generate a pre-signed GET URL for the given S3 key.

    Returns None if S3 is not configured or on any error.
    """
    if not settings.s3_access_key_id:
        return None

    try:
        import aioboto3  # local import — optional dep  # noqa: PLC0415

        session = aioboto3.Session(
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name=settings.s3_region,
        )
        endpoint = settings.s3_endpoint_url or None

        async with session.client("s3", endpoint_url=endpoint) as s3:
            url: str = await s3.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": settings.s3_scorecard_bucket,
                    "Key": s3_key,
                },
                ExpiresIn=expiry_seconds,
            )
        return url
    except Exception as exc:  # broad catch — non-raising pre-sign helper
        log.error(
            "scorecard.presign_failed",
            error_type=type(exc).__name__,
            error=str(exc),
        )
        return None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/scorecards/{scorecard_id}",
    response_model=ScorecardResponse,
    summary="Retrieve a scorecard by ID",
    description=(
        "Returns the scorecard data for the given scorecard_id, including a "
        "30-day pre-signed S3 URL for the PDF report if the PDF has been generated. "
        "JWT required."
    ),
)
async def get_scorecard(
    scorecard_id: str,
    _jwt_payload: Annotated[dict[str, Any], Depends(_require_jwt)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    app_settings: Annotated[Settings, Depends(_get_settings)],
) -> ScorecardResponse:
    """Retrieve a scorecard row and return structured data with a pre-signed PDF URL.

    Returns:
        200 ScorecardResponse on success.
        401 if JWT is missing or invalid.
        404 if no scorecard exists for the given scorecard_id.
    """
    result = await db.execute(
        sa_text(
            """
            SELECT scorecard_id, session_id, scores, composite_score,
                   rationale, strengths, improvements, summary, report_pdf_key
            FROM scorecards
            WHERE scorecard_id = :scorecard_id
            """
        ),
        {"scorecard_id": scorecard_id},
    )
    row = result.mappings().first()

    if row is None:
        log.warning("scorecard.not_found", scorecard_id=scorecard_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scorecard {scorecard_id!r} not found.",
        )

    # Build pre-signed URL if a PDF key is stored.
    pdf_url: str | None = None
    if row["report_pdf_key"]:
        pdf_url = await _generate_presigned_url(
            str(row["report_pdf_key"]),
            app_settings,
        )

    # The DB stores scores as JSONB; SQLAlchemy returns it as a dict already
    # when using asyncpg.  Guard with a json.loads fallback for test mocks
    # where the fixture provides JSON strings.

    def _as_dict(val: Any) -> dict[str, Any]:
        if isinstance(val, dict):
            return val
        return json.loads(val)  # type: ignore[no-any-return]

    def _as_list(val: Any) -> list[Any]:
        if isinstance(val, list):
            return val
        return json.loads(val)  # type: ignore[no-any-return]

    raw_scores = _as_dict(row["scores"])
    raw_rationale = _as_dict(row["rationale"]) if row["rationale"] is not None else {}
    strengths = _as_list(row["strengths"]) if row["strengths"] is not None else []
    improvements_raw = _as_list(row["improvements"]) if row["improvements"] is not None else []

    breakdown = ScoreBreakdown(
        communication=int(raw_scores.get("communication", 0)),
        technical=int(raw_scores.get("technical", 0)),
        problem_solving=int(raw_scores.get("problem_solving", 0)),
        confidence=int(raw_scores.get("confidence", 0)),
    )
    rationale = AxisRationale(
        communication=str(raw_rationale.get("communication", "")),
        technical=str(raw_rationale.get("technical", "")),
        problem_solving=str(raw_rationale.get("problem_solving", "")),
        confidence=str(raw_rationale.get("confidence", "")),
    )
    improvements = [
        ImprovementItem(
            area=str(i.get("area", "")),
            suggestion=str(i.get("suggestion", "")),
        )
        for i in improvements_raw
    ]

    log.info(
        "scorecard.fetched",
        scorecard_id=scorecard_id,
        has_pdf=pdf_url is not None,
    )

    return ScorecardResponse(
        scorecard_id=str(row["scorecard_id"]),
        session_id=str(row["session_id"]),
        composite_score=float(row["composite_score"]),
        scores=breakdown,
        rationale=rationale,
        strengths=[str(s) for s in strengths],
        improvements=improvements,
        summary=str(row["summary"]),
        report_pdf_url=pdf_url,
    )
