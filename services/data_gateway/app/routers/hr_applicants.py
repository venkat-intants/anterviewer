"""HR applicant screening — HR workflow Phase 1.

An HR manager uploads applicant resumes; each is text-extracted, stored in S3,
and ATS-scored (via feedback_billing). HR then sees a ranked list and can
shortlist/reject.

MULTI-TENANT: every endpoint is scoped to the caller's company_id (resolved from
the HR's user row). An HR can NEVER see or touch another company's applicants —
all reads/writes filter by company_id, so a cross-company id returns 404.

  POST   /hr/applicants                 — upload + auto-score an applicant
  GET    /hr/applicants[?status=]       — ranked list (by ATS score)
  GET    /hr/applicants/{id}            — detail
  PATCH  /hr/applicants/{id}            — set status (new|shortlisted|rejected)
  POST   /hr/applicants/{id}/rescore    — re-run ATS scoring
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

import structlog
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from shared.auth.base import User
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.dependencies import require_role
from app.models import Applicant
from app.routers.resume import _delete_from_s3, _extract_pdf_text, _upload_to_s3
from app.scoring_client import ResumeScoreError, score_resume_remote

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/hr", tags=["hr-applicants"])

_MAX_RESUME_BYTES = 5 * 1024 * 1024  # 5 MB
_VALID_STATUSES = {"new", "shortlisted", "rejected"}

DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]


# ---------------------------------------------------------------------------
# Tenant context — resolve the caller's company_id (the isolation boundary)
# ---------------------------------------------------------------------------
async def get_hr_company(
    user: Annotated[User, Depends(require_role("hr_manager"))],
    db: DbSessionDep,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Return (hr_user_id, company_id). 403 if the HR is not assigned a company."""
    try:
        uid = uuid.UUID(user.user_id)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user identity."
        ) from exc
    company_id = await db.scalar(
        text("SELECT company_id FROM users WHERE id = :uid AND deleted_at IS NULL"),
        {"uid": uid},
    )
    if company_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not assigned to a company.",
        )
    return uid, company_id


HrCtxDep = Annotated[tuple[uuid.UUID, uuid.UUID], Depends(get_hr_company)]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ApplicantOut(BaseModel):
    id: str
    full_name: str
    email: str | None
    target_job_title: str
    target_level: str
    status: str
    ats_overall: int | None
    ats_breakdown: dict[str, int] | None
    ats_strengths: list[str] | None
    ats_concerns: list[str] | None
    ats_recommendation: str | None
    ats_summary: str | None
    created_at: str


class StatusUpdate(BaseModel):
    status: str


def _to_out(a: Applicant) -> ApplicantOut:
    # resume_text / s3_key are PII — never returned in the list/detail payload.
    return ApplicantOut(
        id=str(a.id),
        full_name=a.full_name,
        email=a.email,
        target_job_title=a.target_job_title,
        target_level=a.target_level,
        status=a.status,
        ats_overall=a.ats_overall,
        ats_breakdown=a.ats_breakdown,
        ats_strengths=a.ats_strengths,
        ats_concerns=a.ats_concerns,
        ats_recommendation=a.ats_recommendation,
        ats_summary=a.ats_summary,
        created_at=a.created_at.isoformat(),
    )


def _apply_score(a: Applicant, score: dict[str, Any]) -> None:
    a.ats_overall = int(score.get("overall", 0))
    a.ats_breakdown = score.get("breakdown")
    a.ats_strengths = score.get("strengths")
    a.ats_concerns = score.get("concerns")
    a.ats_recommendation = score.get("recommendation")
    a.ats_summary = score.get("summary")
    a.updated_at = datetime.now(tz=UTC)


async def _get_owned(db: AsyncSession, company_id: uuid.UUID, applicant_id: uuid.UUID) -> Applicant:
    """Fetch an applicant scoped to the company, or 404 (tenant isolation)."""
    a = await db.scalar(
        select(Applicant).where(
            Applicant.id == applicant_id,
            Applicant.company_id == company_id,
            Applicant.deleted_at.is_(None),
        )
    )
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Applicant not found.")
    return a


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/applicants", status_code=status.HTTP_201_CREATED, response_model=ApplicantOut)
async def create_applicant(
    file: UploadFile,
    full_name: Annotated[str, Form()],
    target_job_title: Annotated[str, Form()],
    ctx: HrCtxDep,
    db: DbSessionDep,
    email: Annotated[str | None, Form()] = None,
    target_level: Annotated[str, Form()] = "mid",
    target_jd_text: Annotated[str | None, Form()] = None,
) -> ApplicantOut:
    """Upload an applicant's resume, store it, and ATS-score it (best-effort)."""
    hr_uid, company_id = ctx

    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF resumes are accepted.")
    try:
        raw: bytes = await file.read()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not read the uploaded file.") from exc
    if len(raw) > _MAX_RESUME_BYTES:
        raise HTTPException(status_code=400, detail="Resume must be under 5 MB.")
    try:
        resume_text = _extract_pdf_text(raw)
    except Exception as exc:  # noqa: BLE001
        log.warning("hr.applicant.pdf_parse_failed", error_type=type(exc).__name__)
        raise HTTPException(
            status_code=400,
            detail="Could not read the PDF. Please upload a valid, unencrypted PDF.",
        ) from exc

    applicant_id = uuid.uuid4()
    s3_key = f"applicants/{company_id}/{applicant_id}.pdf"
    try:
        await _upload_to_s3(raw, s3_key)
    except (BotoCoreError, ClientError) as exc:
        log.error("hr.applicant.storage_failed", error_type=type(exc).__name__, error=str(exc))
        raise HTTPException(
            status_code=502, detail="Resume storage is currently unavailable. Please try again."
        ) from exc

    now = datetime.now(tz=UTC)
    applicant = Applicant(
        id=applicant_id,
        company_id=company_id,
        created_by_user_id=hr_uid,
        full_name=full_name.strip(),
        email=(email.strip() if email and email.strip() else None),
        target_job_title=target_job_title.strip(),
        target_level=target_level.strip() or "mid",
        target_jd_text=target_jd_text,
        resume_text=resume_text,
        resume_s3_key=s3_key,
        status="new",
        created_at=now,
        updated_at=now,
    )
    db.add(applicant)
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        log.error("hr.applicant.db_write_failed", error_type=type(exc).__name__)
        await _delete_from_s3(s3_key)
        raise HTTPException(
            status_code=503, detail="Could not save the applicant. Please try again."
        ) from exc

    # ATS scoring is best-effort: a scorer outage must NOT lose the applicant.
    try:
        score = await score_resume_remote(
            resume_text=resume_text,
            job_title=applicant.target_job_title,
            level=applicant.target_level,
            jd_text=applicant.target_jd_text,
            acting_user_id=str(hr_uid),
        )
        _apply_score(applicant, score)
        await db.commit()
    except ResumeScoreError as exc:
        log.warning("hr.applicant.score_unavailable", error=str(exc))
        # Applicant persists unscored; HR can POST /rescore later.

    log.info(
        "hr.applicant.created",
        applicant_id=str(applicant_id),
        company_id=str(company_id),
        scored=applicant.ats_overall is not None,
    )
    return _to_out(applicant)


@router.get("/applicants", response_model=list[ApplicantOut])
async def list_applicants(
    ctx: HrCtxDep,
    db: DbSessionDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> list[ApplicantOut]:
    """Ranked applicant list for the caller's company (highest ATS score first)."""
    _hr_uid, company_id = ctx
    stmt = select(Applicant).where(
        Applicant.company_id == company_id, Applicant.deleted_at.is_(None)
    )
    if status_filter:
        stmt = stmt.where(Applicant.status == status_filter)
    stmt = stmt.order_by(
        Applicant.ats_overall.desc().nullslast(), Applicant.created_at.desc()
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_out(a) for a in rows]


@router.get("/applicants/{applicant_id}", response_model=ApplicantOut)
async def get_applicant(applicant_id: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep) -> ApplicantOut:
    _hr_uid, company_id = ctx
    return _to_out(await _get_owned(db, company_id, applicant_id))


@router.patch("/applicants/{applicant_id}", response_model=ApplicantOut)
async def update_applicant_status(
    applicant_id: uuid.UUID, body: StatusUpdate, ctx: HrCtxDep, db: DbSessionDep
) -> ApplicantOut:
    _hr_uid, company_id = ctx
    if body.status not in _VALID_STATUSES:
        raise HTTPException(
            status_code=400, detail=f"status must be one of {sorted(_VALID_STATUSES)}"
        )
    a = await _get_owned(db, company_id, applicant_id)
    a.status = body.status
    a.updated_at = datetime.now(tz=UTC)
    await db.commit()
    return _to_out(a)


@router.post("/applicants/{applicant_id}/rescore", response_model=ApplicantOut)
async def rescore_applicant(
    applicant_id: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep
) -> ApplicantOut:
    hr_uid, company_id = ctx
    a = await _get_owned(db, company_id, applicant_id)
    if not a.resume_text:
        raise HTTPException(status_code=400, detail="No resume text on file to score.")
    try:
        score = await score_resume_remote(
            resume_text=a.resume_text,
            job_title=a.target_job_title,
            level=a.target_level,
            jd_text=a.target_jd_text,
            acting_user_id=str(hr_uid),
        )
    except ResumeScoreError as exc:
        raise HTTPException(status_code=502, detail=f"Resume scoring failed: {exc}") from exc
    _apply_score(a, score)
    await db.commit()
    return _to_out(a)
