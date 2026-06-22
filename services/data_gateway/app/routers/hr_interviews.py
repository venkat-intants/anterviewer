"""HR 'invite to interview' + results — HR workflow Phase 3.

An HR manager invites an exam-passed (or shortlisted) applicant into the EXISTING
avatar interview. At invite time we mint ONLY an opaque-token interview_invites row
(lazy provisioning — the guest user/session/consent are created when the applicant
first redeems the link in interview_take.py). HR then sees invite status + the
graded interview result once the avatar session completes.

MULTI-TENANT: every endpoint is company-scoped (reuses get_hr_company/HrCtxDep).
Cross-company ids return 404.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.interview_link import hash_interview_token, mint_interview_token
from app.models import Applicant, InterviewInvite, Job, Scorecard
from app.routers.hr_applicants import DbSessionDep, HrCtxDep, _get_owned

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/hr", tags=["hr-interviews"])

_LANGS = {"en", "hi", "te"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class InviteCreateIn(BaseModel):
    applicant_id: uuid.UUID
    job_id: uuid.UUID | None = None
    job_title: str | None = Field(default=None, max_length=300)
    level: str | None = None
    language: str = "en"
    scheduled_at: datetime | None = None
    ttl_hours: int | None = Field(default=None, ge=1, le=8760)

    @field_validator("language")
    @classmethod
    def _lang(cls, v: str) -> str:
        if v not in _LANGS:
            raise ValueError(f"language must be one of {sorted(_LANGS)}")
        return v


class InviteResult(BaseModel):
    invite_id: str
    applicant_id: str
    applicant_name: str
    job_title: str
    magic_link: str  # raw token embedded — returned ONCE, at mint time only
    expires_at: str
    scheduled_at: str | None
    status: str


class InviteOut(BaseModel):
    invite_id: str
    applicant_id: str
    applicant_name: str
    job_title: str
    language: str
    status: str
    scheduled_at: str | None
    expires_at: str
    created_at: str
    composite_score: float | None
    scorecard_id: str | None


class EligibleApplicantOut(BaseModel):
    id: str
    full_name: str
    target_job_title: str
    target_level: str
    status: str
    ats_overall: int | None
    passed_exam: bool
    has_active_invite: bool


class InterviewOutcome(BaseModel):
    invite_id: str
    applicant_id: str
    applicant_name: str
    status: str
    session_status: str | None
    scorecard_id: str | None
    composite_score: float | None
    scores: dict[str, Any] | None
    strengths: list[Any] | None
    improvements: list[Any] | None
    summary: str | None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _has_passed_exam(db: AsyncSession, company_id: uuid.UUID, applicant_id: uuid.UUID) -> bool:
    row = await db.scalar(
        text(
            "SELECT 1 FROM exam_attempts WHERE applicant_id = :aid AND company_id = :cid "
            "AND passed IS TRUE AND status = 'submitted' AND deleted_at IS NULL LIMIT 1"
        ),
        {"aid": applicant_id, "cid": company_id},
    )
    return row is not None


async def _get_owned_invite(
    db: AsyncSession, company_id: uuid.UUID, invite_id: uuid.UUID
) -> InterviewInvite:
    inv = await db.scalar(
        select(InterviewInvite).where(
            InterviewInvite.id == invite_id,
            InterviewInvite.company_id == company_id,
            InterviewInvite.deleted_at.is_(None),
        )
    )
    if inv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found.")
    return inv


async def _resolve_job(
    db: AsyncSession, hr_uid: uuid.UUID, company_id: uuid.UUID, applicant: Applicant, body: InviteCreateIn
) -> Job:
    """Pick the interview job: an explicit tenant-owned/global job_id, else create a
    tenant-owned job from the applicant's screening role so the prompt is grounded."""
    if body.job_id is not None:
        job = await db.scalar(select(Job).where(Job.id == body.job_id, Job.is_active.is_(True)))
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found or inactive.")
        # M4: a tenant-owned job must belong to this company.
        if job.created_by_user_id is not None:
            owner_company = await db.scalar(
                text("SELECT company_id FROM users WHERE id = :uid"),
                {"uid": job.created_by_user_id},
            )
            if owner_company is not None and owner_company != company_id:
                raise HTTPException(status_code=404, detail="Job not found.")
        return job

    title = (body.job_title or applicant.target_job_title or "the role").strip()
    level = (body.level or applicant.target_level or "mid").strip()
    now = datetime.now(tz=UTC)
    job = Job(
        id=uuid.uuid4(),
        title=title,
        description=title,
        level=level if level in ("entry", "mid", "senior") else "mid",
        language=body.language,
        nos_codes=[],
        competencies={},
        is_active=True,
        jd_text=applicant.target_jd_text,
        created_by_user_id=hr_uid,  # tenant-owned (M4)
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    await db.flush()
    return job


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/interviews/eligible-applicants", response_model=list[EligibleApplicantOut])
async def eligible_applicants(
    ctx: HrCtxDep,
    db: DbSessionDep,
    source: Annotated[str, Query()] = "any",
) -> list[EligibleApplicantOut]:
    """Applicants ready for an interview: shortlisted and/or passed an exam."""
    _hr_uid, company_id = ctx
    rows = (
        await db.execute(
            select(Applicant)
            .where(Applicant.company_id == company_id, Applicant.deleted_at.is_(None))
            .order_by(Applicant.ats_overall.desc().nullslast(), Applicant.created_at.desc())
        )
    ).scalars().all()

    out: list[EligibleApplicantOut] = []
    for a in rows:
        passed = await _has_passed_exam(db, company_id, a.id)
        is_shortlisted = a.status == "shortlisted"
        if source == "shortlisted" and not is_shortlisted:
            continue
        if source == "exam_passed" and not passed:
            continue
        if source == "any" and not (is_shortlisted or passed):
            continue
        active = await db.scalar(
            select(InterviewInvite.id).where(
                InterviewInvite.applicant_id == a.id,
                InterviewInvite.company_id == company_id,
                InterviewInvite.status.in_(("invited", "consumed")),
                InterviewInvite.deleted_at.is_(None),
            )
        )
        out.append(
            EligibleApplicantOut(
                id=str(a.id), full_name=a.full_name, target_job_title=a.target_job_title,
                target_level=a.target_level, status=a.status, ats_overall=a.ats_overall,
                passed_exam=passed, has_active_invite=active is not None,
            )
        )
    return out


@router.post("/interviews", status_code=status.HTTP_201_CREATED, response_model=InviteResult)
async def create_invite(body: InviteCreateIn, ctx: HrCtxDep, db: DbSessionDep) -> InviteResult:
    hr_uid, company_id = ctx
    applicant = await _get_owned(db, company_id, body.applicant_id)

    # Funnel gate: only shortlisted or exam-passed applicants are interview-eligible.
    if applicant.status != "shortlisted" and not await _has_passed_exam(db, company_id, applicant.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Applicant must be shortlisted or have passed an exam before an interview.",
        )

    if body.scheduled_at is not None and body.scheduled_at < datetime.now(tz=UTC):
        raise HTTPException(status_code=422, detail="scheduled_at cannot be in the past.")

    job = await _resolve_job(db, hr_uid, company_id, applicant, body)

    # Rotate any active invite for this (applicant, job) so the active partial-unique holds.
    prior = await db.scalar(
        select(InterviewInvite).where(
            InterviewInvite.applicant_id == applicant.id,
            InterviewInvite.job_id == job.id,
            InterviewInvite.company_id == company_id,
            InterviewInvite.status.in_(("invited", "consumed")),
            InterviewInvite.deleted_at.is_(None),
        )
    )
    now = datetime.now(tz=UTC)
    if prior is not None:
        prior.status = "revoked"
        prior.updated_at = now
        await db.flush()

    ttl_hours = body.ttl_hours or settings.interview_link_ttl_hours
    raw_token = mint_interview_token()
    invite = InterviewInvite(
        id=uuid.uuid4(),
        company_id=company_id,
        applicant_id=applicant.id,
        job_id=job.id,
        created_by_user_id=hr_uid,
        token_hash=hash_interview_token(raw_token, settings.interview_link_secret),
        language=body.language,
        expires_at=now + timedelta(hours=ttl_hours),
        scheduled_at=body.scheduled_at,
        status="invited",
        created_at=now,
        updated_at=now,
    )
    db.add(invite)
    await db.commit()

    base = settings.interview_link_base_url.rstrip("/")
    log.info("hr.interview.invited", invite_id=str(invite.id), company_id=str(company_id))
    return InviteResult(
        invite_id=str(invite.id),
        applicant_id=str(applicant.id),
        applicant_name=applicant.full_name,
        job_title=job.title,
        magic_link=f"{base}/interview-invite#{raw_token}",
        expires_at=invite.expires_at.isoformat(),
        scheduled_at=invite.scheduled_at.isoformat() if invite.scheduled_at else None,
        status=invite.status,
    )


@router.get("/interviews", response_model=list[InviteOut])
async def list_invites(
    ctx: HrCtxDep,
    db: DbSessionDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    applicant_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[InviteOut]:
    _hr_uid, company_id = ctx
    stmt = (
        select(
            InterviewInvite, Applicant.full_name, Job.title,
            Scorecard.scorecard_id, Scorecard.composite_score,
        )
        .join(Applicant, Applicant.id == InterviewInvite.applicant_id)
        .join(Job, Job.id == InterviewInvite.job_id)
        .outerjoin(Scorecard, Scorecard.session_id == InterviewInvite.session_id)
        .where(InterviewInvite.company_id == company_id, InterviewInvite.deleted_at.is_(None))
        .order_by(InterviewInvite.created_at.desc())
    )
    if status_filter:
        stmt = stmt.where(InterviewInvite.status == status_filter)
    if applicant_id is not None:
        stmt = stmt.where(InterviewInvite.applicant_id == applicant_id)
    rows = (await db.execute(stmt)).all()

    # Lazy completion: a scorecard exists -> flip consumed -> completed (frees the slot).
    now = datetime.now(tz=UTC)
    dirty = False
    out: list[InviteOut] = []
    for inv, name, title, scorecard_id, composite in rows:
        if scorecard_id is not None and inv.status == "consumed":
            inv.status = "completed"
            inv.updated_at = now
            dirty = True
        out.append(
            InviteOut(
                invite_id=str(inv.id), applicant_id=str(inv.applicant_id), applicant_name=name,
                job_title=title, language=inv.language, status=inv.status,
                scheduled_at=inv.scheduled_at.isoformat() if inv.scheduled_at else None,
                expires_at=inv.expires_at.isoformat(), created_at=inv.created_at.isoformat(),
                composite_score=float(composite) if composite is not None else None,
                scorecard_id=str(scorecard_id) if scorecard_id else None,
            )
        )
    if dirty:
        await db.commit()
    return out


@router.get("/interviews/{invite_id}", response_model=InviteOut)
async def get_invite(invite_id: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep) -> InviteOut:
    _hr_uid, company_id = ctx
    inv = await _get_owned_invite(db, company_id, invite_id)
    name = await db.scalar(select(Applicant.full_name).where(Applicant.id == inv.applicant_id))
    title = await db.scalar(select(Job.title).where(Job.id == inv.job_id))
    sc = None
    composite = None
    if inv.session_id is not None:
        row = (
            await db.execute(
                select(Scorecard.scorecard_id, Scorecard.composite_score).where(
                    Scorecard.session_id == inv.session_id
                )
            )
        ).first()
        if row is not None:
            sc, composite = row
    return InviteOut(
        invite_id=str(inv.id), applicant_id=str(inv.applicant_id), applicant_name=name or "",
        job_title=title or "", language=inv.language, status=inv.status,
        scheduled_at=inv.scheduled_at.isoformat() if inv.scheduled_at else None,
        expires_at=inv.expires_at.isoformat(), created_at=inv.created_at.isoformat(),
        composite_score=float(composite) if composite is not None else None,
        scorecard_id=str(sc) if sc else None,
    )


@router.post("/interviews/{invite_id}/revoke", response_model=InviteOut)
async def revoke_invite(invite_id: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep) -> InviteOut:
    _hr_uid, company_id = ctx
    inv = await _get_owned_invite(db, company_id, invite_id)
    # Kills the link + future redeems immediately. Cannot claw back an already-issued
    # in-flight guest JWT (no jti denylist) — mitigated by the short TTL + single-use.
    inv.status = "revoked"
    inv.updated_at = datetime.now(tz=UTC)
    await db.commit()
    name = await db.scalar(select(Applicant.full_name).where(Applicant.id == inv.applicant_id))
    title = await db.scalar(select(Job.title).where(Job.id == inv.job_id))
    return InviteOut(
        invite_id=str(inv.id), applicant_id=str(inv.applicant_id), applicant_name=name or "",
        job_title=title or "", language=inv.language, status=inv.status,
        scheduled_at=inv.scheduled_at.isoformat() if inv.scheduled_at else None,
        expires_at=inv.expires_at.isoformat(), created_at=inv.created_at.isoformat(),
        composite_score=None, scorecard_id=None,
    )


@router.get("/interviews/{invite_id}/result", response_model=InterviewOutcome)
async def invite_result(invite_id: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep) -> InterviewOutcome:
    _hr_uid, company_id = ctx
    inv = await _get_owned_invite(db, company_id, invite_id)
    name = await db.scalar(select(Applicant.full_name).where(Applicant.id == inv.applicant_id))
    session_status: str | None = None
    sc: Scorecard | None = None
    if inv.session_id is not None:
        session_status = await db.scalar(
            text("SELECT status FROM sessions WHERE id = :sid"), {"sid": inv.session_id}
        )
        sc = await db.scalar(
            select(Scorecard).where(Scorecard.session_id == inv.session_id)
        )
    return InterviewOutcome(
        invite_id=str(inv.id), applicant_id=str(inv.applicant_id), applicant_name=name or "",
        status=inv.status, session_status=session_status,
        scorecard_id=str(sc.scorecard_id) if sc else None,
        composite_score=float(sc.composite_score) if sc and sc.composite_score is not None else None,
        scores=sc.scores if sc else None,
        strengths=sc.strengths if sc else None,
        improvements=sc.improvements if sc else None,
        summary=sc.summary if sc else None,
    )
