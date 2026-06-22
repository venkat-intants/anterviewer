"""HR MCQ exam authoring + results — HR workflow Phase 2.

An HR manager authors an exam (MCQ questions + pass threshold), publishes it,
assigns it to applicants (minting an opaque magic-link the applicant uses to take
it WITHOUT logging in), and reviews graded results.

MULTI-TENANT: every endpoint is scoped to the caller's company_id (reusing the
Phase-1 get_hr_company/HrCtxDep). An HR can NEVER see or touch another company's
exams — all reads/writes filter by company_id, so a cross-company id returns 404.

SECURITY:
  - correct_index is returned ONLY to HR (authoring/detail/breakdown) — never on
    the applicant take path (that lives in exam_take.py).
  - Questions LOCK (409) once any attempt exists, so a graded exam can't be
    silently changed under candidates.
  - Magic-link mint returns the RAW token exactly once; only its HMAC hash is
    stored. Re-assigning rotates the link (revokes the prior active one).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.exam_grading import GradeInput, GradeQuestion, grade_breakdown
from app.exam_link import hash_exam_token, mint_exam_token
from app.models import Applicant, Exam, ExamAssignment, ExamAttempt, ExamQuestion
from app.routers.hr_applicants import DbSessionDep, HrCtxDep

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/hr", tags=["hr-exams"])

_VALID_STATUSES = {"draft", "published", "closed"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ExamCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    target_job_title: str | None = None
    pass_threshold: int = Field(default=60, ge=0, le=100)
    time_limit_seconds: int | None = Field(default=None, ge=10, le=86_400)
    allow_retake: bool = False


class ExamUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    target_job_title: str | None = None
    pass_threshold: int | None = Field(default=None, ge=0, le=100)
    time_limit_seconds: int | None = Field(default=None, ge=10, le=86_400)
    allow_retake: bool | None = None
    status: str | None = None

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(_VALID_STATUSES)}")
        return v


class QuestionIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0)
    points: int = Field(default=1, ge=1, le=100)

    @field_validator("options")
    @classmethod
    def _validate_options(cls, v: list[str]) -> list[str]:
        cleaned = [o.strip() for o in v]
        if any(not o for o in cleaned):
            raise ValueError("options must be non-empty strings")
        return cleaned

    @model_validator(mode="after")
    def _validate_correct_index(self) -> QuestionIn:
        if self.correct_index >= len(self.options):
            raise ValueError("correct_index out of range for options")
        return self


class QuestionUpdateIn(BaseModel):
    prompt: str | None = Field(default=None, min_length=1, max_length=2000)
    options: list[str] | None = Field(default=None, min_length=2, max_length=6)
    correct_index: int | None = Field(default=None, ge=0)
    points: int | None = Field(default=None, ge=1, le=100)

    @field_validator("options")
    @classmethod
    def _validate_options(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        cleaned = [o.strip() for o in v]
        if any(not o for o in cleaned):
            raise ValueError("options must be non-empty strings")
        return cleaned


class ReorderIn(BaseModel):
    question_ids: list[uuid.UUID] = Field(min_length=1)


class AssignIn(BaseModel):
    applicant_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    ttl_hours: int | None = Field(default=None, ge=1, le=8760)


class QuestionOut(BaseModel):
    """HR-facing question — INCLUDES correct_index (HR only; never on take path)."""

    id: str
    prompt: str
    options: list[str]
    correct_index: int
    points: int
    position: int


class ExamOut(BaseModel):
    id: str
    title: str
    description: str | None
    target_job_title: str | None
    pass_threshold: int
    time_limit_seconds: int | None
    allow_retake: bool
    status: str
    created_at: str


class ExamSummaryOut(ExamOut):
    question_count: int
    attempt_count: int


class ExamDetailOut(ExamOut):
    questions: list[QuestionOut]
    attempt_count: int


class AssignOut(BaseModel):
    assignment_id: str
    applicant_id: str
    applicant_name: str
    magic_link: str  # raw token embedded — returned ONCE, at mint time only
    expires_at: str
    status: str


class AssignmentOut(BaseModel):
    assignment_id: str
    applicant_id: str
    applicant_name: str
    status: str
    expires_at: str
    consumed_at: str | None
    created_at: str


class AttemptResultOut(BaseModel):
    attempt_id: str
    applicant_id: str
    applicant_name: str
    score_raw: int | None
    score_max: int | None
    score_percent: int | None
    passed: bool | None
    status: str
    submitted_at: str | None
    attempt_no: int


# ---------------------------------------------------------------------------
# Helpers (tenant isolation lives here)
# ---------------------------------------------------------------------------
async def _get_owned_exam(db: AsyncSession, company_id: uuid.UUID, exam_id: uuid.UUID) -> Exam:
    exam = await db.scalar(
        select(Exam).where(
            Exam.id == exam_id, Exam.company_id == company_id, Exam.deleted_at.is_(None)
        )
    )
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found.")
    return exam


async def _attempt_count(db: AsyncSession, company_id: uuid.UUID, exam_id: uuid.UUID) -> int:
    n = await db.scalar(
        select(func.count()).select_from(ExamAttempt).where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.company_id == company_id,
            ExamAttempt.deleted_at.is_(None),
        )
    )
    return int(n or 0)


async def _live_questions(
    db: AsyncSession, company_id: uuid.UUID, exam_id: uuid.UUID
) -> list[ExamQuestion]:
    rows = (
        await db.execute(
            select(ExamQuestion)
            .where(
                ExamQuestion.exam_id == exam_id,
                ExamQuestion.company_id == company_id,
                ExamQuestion.deleted_at.is_(None),
            )
            .order_by(ExamQuestion.position.asc())
        )
    ).scalars().all()
    return list(rows)


async def _get_owned_question(
    db: AsyncSession, company_id: uuid.UUID, exam_id: uuid.UUID, qid: uuid.UUID
) -> ExamQuestion:
    q = await db.scalar(
        select(ExamQuestion).where(
            ExamQuestion.id == qid,
            ExamQuestion.exam_id == exam_id,
            ExamQuestion.company_id == company_id,
            ExamQuestion.deleted_at.is_(None),
        )
    )
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found.")
    return q


async def _require_no_attempts(
    db: AsyncSession, company_id: uuid.UUID, exam_id: uuid.UUID
) -> None:
    """Questions are immutable once any attempt exists (graded-exam integrity)."""
    if await _attempt_count(db, company_id, exam_id) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This exam already has attempts — its questions are locked.",
        )


def _exam_out(e: Exam) -> ExamOut:
    return ExamOut(
        id=str(e.id),
        title=e.title,
        description=e.description,
        target_job_title=e.target_job_title,
        pass_threshold=e.pass_threshold,
        time_limit_seconds=e.time_limit_seconds,
        allow_retake=e.allow_retake,
        status=e.status,
        created_at=e.created_at.isoformat(),
    )


def _question_out(q: ExamQuestion) -> QuestionOut:
    return QuestionOut(
        id=str(q.id),
        prompt=q.prompt,
        options=list(q.options or []),
        correct_index=q.correct_index,
        points=q.points,
        position=q.position,
    )


# ---------------------------------------------------------------------------
# Exam CRUD
# ---------------------------------------------------------------------------
@router.post("/exams", status_code=status.HTTP_201_CREATED, response_model=ExamOut)
async def create_exam(body: ExamCreateIn, ctx: HrCtxDep, db: DbSessionDep) -> ExamOut:
    hr_uid, company_id = ctx
    now = datetime.now(tz=UTC)
    exam = Exam(
        id=uuid.uuid4(),
        company_id=company_id,
        created_by_user_id=hr_uid,
        title=body.title.strip(),
        description=body.description,
        target_job_title=body.target_job_title,
        pass_threshold=body.pass_threshold,
        time_limit_seconds=body.time_limit_seconds,
        allow_retake=body.allow_retake,
        status="draft",
        created_at=now,
        updated_at=now,
    )
    db.add(exam)
    await db.commit()
    log.info("hr.exam.created", exam_id=str(exam.id), company_id=str(company_id))
    return _exam_out(exam)


@router.get("/exams", response_model=list[ExamSummaryOut])
async def list_exams(
    ctx: HrCtxDep,
    db: DbSessionDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> list[ExamSummaryOut]:
    _hr_uid, company_id = ctx
    stmt = select(Exam).where(Exam.company_id == company_id, Exam.deleted_at.is_(None))
    if status_filter:
        stmt = stmt.where(Exam.status == status_filter)
    stmt = stmt.order_by(Exam.created_at.desc())
    exams = (await db.execute(stmt)).scalars().all()

    out: list[ExamSummaryOut] = []
    for e in exams:
        qn = await db.scalar(
            select(func.count()).select_from(ExamQuestion).where(
                ExamQuestion.exam_id == e.id, ExamQuestion.deleted_at.is_(None)
            )
        )
        an = await _attempt_count(db, company_id, e.id)
        out.append(
            ExamSummaryOut(**_exam_out(e).model_dump(), question_count=int(qn or 0), attempt_count=an)
        )
    return out


@router.get("/exams/{exam_id}", response_model=ExamDetailOut)
async def get_exam(exam_id: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep) -> ExamDetailOut:
    _hr_uid, company_id = ctx
    exam = await _get_owned_exam(db, company_id, exam_id)
    questions = await _live_questions(db, company_id, exam_id)
    an = await _attempt_count(db, company_id, exam_id)
    return ExamDetailOut(
        **_exam_out(exam).model_dump(),
        questions=[_question_out(q) for q in questions],
        attempt_count=an,
    )


@router.patch("/exams/{exam_id}", response_model=ExamOut)
async def update_exam(
    exam_id: uuid.UUID, body: ExamUpdateIn, ctx: HrCtxDep, db: DbSessionDep
) -> ExamOut:
    _hr_uid, company_id = ctx
    exam = await _get_owned_exam(db, company_id, exam_id)

    if body.status == "published":
        live = await _live_questions(db, company_id, exam_id)
        if not live:
            raise HTTPException(
                status_code=400, detail="Add at least one question before publishing."
            )

    if body.title is not None:
        exam.title = body.title.strip()
    if body.description is not None:
        exam.description = body.description
    if body.target_job_title is not None:
        exam.target_job_title = body.target_job_title
    if body.pass_threshold is not None:
        exam.pass_threshold = body.pass_threshold
    if body.time_limit_seconds is not None:
        exam.time_limit_seconds = body.time_limit_seconds
    if body.allow_retake is not None:
        exam.allow_retake = body.allow_retake
    if body.status is not None:
        exam.status = body.status
    exam.updated_at = datetime.now(tz=UTC)
    await db.commit()
    return _exam_out(exam)


# ---------------------------------------------------------------------------
# Questions (locked once attempts exist)
# ---------------------------------------------------------------------------
@router.post(
    "/exams/{exam_id}/questions", status_code=status.HTTP_201_CREATED, response_model=QuestionOut
)
async def add_question(
    exam_id: uuid.UUID, body: QuestionIn, ctx: HrCtxDep, db: DbSessionDep
) -> QuestionOut:
    _hr_uid, company_id = ctx
    await _get_owned_exam(db, company_id, exam_id)
    await _require_no_attempts(db, company_id, exam_id)

    max_pos = await db.scalar(
        select(func.max(ExamQuestion.position)).where(
            ExamQuestion.exam_id == exam_id, ExamQuestion.deleted_at.is_(None)
        )
    )
    now = datetime.now(tz=UTC)
    q = ExamQuestion(
        id=uuid.uuid4(),
        exam_id=exam_id,
        company_id=company_id,
        prompt=body.prompt.strip(),
        options=body.options,
        correct_index=body.correct_index,
        points=body.points,
        position=(int(max_pos) + 1) if max_pos is not None else 0,
        created_at=now,
        updated_at=now,
    )
    db.add(q)
    await db.commit()
    return _question_out(q)


@router.patch("/exams/{exam_id}/questions/{qid}", response_model=QuestionOut)
async def update_question(
    exam_id: uuid.UUID, qid: uuid.UUID, body: QuestionUpdateIn, ctx: HrCtxDep, db: DbSessionDep
) -> QuestionOut:
    _hr_uid, company_id = ctx
    await _get_owned_exam(db, company_id, exam_id)
    await _require_no_attempts(db, company_id, exam_id)
    q = await _get_owned_question(db, company_id, exam_id, qid)

    new_options = body.options if body.options is not None else list(q.options or [])
    new_correct = body.correct_index if body.correct_index is not None else q.correct_index
    if new_correct >= len(new_options):
        raise HTTPException(status_code=400, detail="correct_index out of range for options.")

    if body.prompt is not None:
        q.prompt = body.prompt.strip()
    q.options = new_options
    q.correct_index = new_correct
    if body.points is not None:
        q.points = body.points
    q.updated_at = datetime.now(tz=UTC)
    await db.commit()
    return _question_out(q)


@router.delete("/exams/{exam_id}/questions/{qid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    exam_id: uuid.UUID, qid: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep
) -> Response:
    _hr_uid, company_id = ctx
    exam = await _get_owned_exam(db, company_id, exam_id)
    await _require_no_attempts(db, company_id, exam_id)
    q = await _get_owned_question(db, company_id, exam_id, qid)

    live = await _live_questions(db, company_id, exam_id)
    if exam.status == "published" and len(live) <= 1:
        raise HTTPException(
            status_code=400,
            detail="A published exam must keep at least one question. Unpublish first.",
        )
    q.deleted_at = datetime.now(tz=UTC)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/exams/{exam_id}/questions/order", response_model=list[QuestionOut])
async def reorder_questions(
    exam_id: uuid.UUID, body: ReorderIn, ctx: HrCtxDep, db: DbSessionDep
) -> list[QuestionOut]:
    _hr_uid, company_id = ctx
    await _get_owned_exam(db, company_id, exam_id)
    await _require_no_attempts(db, company_id, exam_id)

    live = await _live_questions(db, company_id, exam_id)
    if {q.id for q in live} != set(body.question_ids):
        raise HTTPException(
            status_code=400, detail="question_ids must be exactly the exam's live questions."
        )
    by_id = {q.id: q for q in live}
    # Two-phase to dodge the live (exam_id, position) partial-unique index: park
    # all rows at a high offset, flush, then assign the final 0..n-1 positions.
    for idx, qid in enumerate(body.question_ids):
        by_id[qid].position = 10_000 + idx
    await db.flush()
    now = datetime.now(tz=UTC)
    for idx, qid in enumerate(body.question_ids):
        by_id[qid].position = idx
        by_id[qid].updated_at = now
    await db.commit()
    return [_question_out(by_id[qid]) for qid in body.question_ids]


# ---------------------------------------------------------------------------
# Assignments (magic-link mint / list / revoke)
# ---------------------------------------------------------------------------
@router.post(
    "/exams/{exam_id}/assignments", status_code=status.HTTP_201_CREATED, response_model=list[AssignOut]
)
async def assign_exam(
    exam_id: uuid.UUID, body: AssignIn, ctx: HrCtxDep, db: DbSessionDep
) -> list[AssignOut]:
    hr_uid, company_id = ctx
    exam = await _get_owned_exam(db, company_id, exam_id)
    if exam.status != "published":
        raise HTTPException(status_code=409, detail="Publish the exam before assigning it.")

    ttl_hours = body.ttl_hours or settings.exam_link_ttl_hours
    now = datetime.now(tz=UTC)
    expires_at = now + timedelta(hours=ttl_hours)
    base = settings.exam_link_base_url.rstrip("/")

    out: list[AssignOut] = []
    for applicant_id in body.applicant_ids:
        applicant = await db.scalar(
            select(Applicant).where(
                Applicant.id == applicant_id,
                Applicant.company_id == company_id,  # tenant scope: skip foreign applicants
                Applicant.deleted_at.is_(None),
            )
        )
        if applicant is None:
            continue  # not this company's applicant — silently skip

        # Rotate: revoke any existing active (invited) assignment for this pair so
        # only one live link exists (the active partial-unique index enforces this).
        prior = await db.scalar(
            select(ExamAssignment).where(
                ExamAssignment.exam_id == exam_id,
                ExamAssignment.applicant_id == applicant_id,
                ExamAssignment.company_id == company_id,
                ExamAssignment.status == "invited",
                ExamAssignment.deleted_at.is_(None),
            )
        )
        if prior is not None:
            prior.status = "revoked"
            prior.updated_at = now
            await db.flush()

        raw_token = mint_exam_token()
        asn = ExamAssignment(
            id=uuid.uuid4(),
            company_id=company_id,
            exam_id=exam_id,
            applicant_id=applicant_id,
            created_by_user_id=hr_uid,
            token_hash=hash_exam_token(raw_token, settings.exam_link_secret),
            expires_at=expires_at,
            status="invited",
            created_at=now,
            updated_at=now,
        )
        db.add(asn)
        await db.flush()
        out.append(
            AssignOut(
                assignment_id=str(asn.id),
                applicant_id=str(applicant_id),
                applicant_name=applicant.full_name,
                magic_link=f"{base}/exam#{raw_token}",  # raw token returned ONCE
                expires_at=expires_at.isoformat(),
                status=asn.status,
            )
        )

    if not out:
        raise HTTPException(status_code=400, detail="No valid applicants in your company.")
    await db.commit()
    log.info(
        "hr.exam.assigned", exam_id=str(exam_id), company_id=str(company_id), count=len(out)
    )
    return out


@router.get("/exams/{exam_id}/assignments", response_model=list[AssignmentOut])
async def list_assignments(
    exam_id: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep
) -> list[AssignmentOut]:
    _hr_uid, company_id = ctx
    await _get_owned_exam(db, company_id, exam_id)
    rows = (
        await db.execute(
            select(ExamAssignment, Applicant.full_name)
            .join(Applicant, Applicant.id == ExamAssignment.applicant_id)
            .where(
                ExamAssignment.exam_id == exam_id,
                ExamAssignment.company_id == company_id,
                ExamAssignment.deleted_at.is_(None),
            )
            .order_by(ExamAssignment.created_at.desc())
        )
    ).all()
    return [
        AssignmentOut(
            assignment_id=str(a.id),
            applicant_id=str(a.applicant_id),
            applicant_name=name,
            status=a.status,
            expires_at=a.expires_at.isoformat(),
            consumed_at=a.consumed_at.isoformat() if a.consumed_at else None,
            created_at=a.created_at.isoformat(),
        )
        for a, name in rows
    ]


@router.post("/exams/{exam_id}/assignments/{aid}/revoke", response_model=AssignmentOut)
async def revoke_assignment(
    exam_id: uuid.UUID, aid: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep
) -> AssignmentOut:
    _hr_uid, company_id = ctx
    asn = await db.scalar(
        select(ExamAssignment).where(
            ExamAssignment.id == aid,
            ExamAssignment.exam_id == exam_id,
            ExamAssignment.company_id == company_id,
            ExamAssignment.deleted_at.is_(None),
        )
    )
    if asn is None:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    asn.status = "revoked"  # the token dies immediately on the take path
    asn.updated_at = datetime.now(tz=UTC)
    await db.commit()
    applicant_name = await db.scalar(
        select(Applicant.full_name).where(Applicant.id == asn.applicant_id)
    )
    return AssignmentOut(
        assignment_id=str(asn.id),
        applicant_id=str(asn.applicant_id),
        applicant_name=applicant_name or "",
        status=asn.status,
        expires_at=asn.expires_at.isoformat(),
        consumed_at=asn.consumed_at.isoformat() if asn.consumed_at else None,
        created_at=asn.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
@router.get("/exams/{exam_id}/attempts", response_model=list[AttemptResultOut])
async def list_attempts(
    exam_id: uuid.UUID,
    ctx: HrCtxDep,
    db: DbSessionDep,
    passed: Annotated[bool | None, Query()] = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> list[AttemptResultOut]:
    _hr_uid, company_id = ctx
    await _get_owned_exam(db, company_id, exam_id)
    stmt = (
        select(ExamAttempt, Applicant.full_name)
        .join(Applicant, Applicant.id == ExamAttempt.applicant_id)
        .where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.company_id == company_id,
            ExamAttempt.deleted_at.is_(None),
        )
    )
    if passed is not None:
        stmt = stmt.where(ExamAttempt.passed.is_(passed))
    if status_filter:
        stmt = stmt.where(ExamAttempt.status == status_filter)
    stmt = stmt.order_by(ExamAttempt.score_percent.desc().nullslast(), ExamAttempt.submitted_at.desc())
    rows = (await db.execute(stmt)).all()
    return [
        AttemptResultOut(
            attempt_id=str(at.id),
            applicant_id=str(at.applicant_id),
            applicant_name=name,
            score_raw=at.score_raw,
            score_max=at.score_max,
            score_percent=at.score_percent,
            passed=at.passed,
            status=at.status,
            submitted_at=at.submitted_at.isoformat() if at.submitted_at else None,
            attempt_no=at.attempt_no,
        )
        for at, name in rows
    ]


@router.get("/exams/{exam_id}/attempts/{aid}/breakdown")
async def attempt_breakdown(
    exam_id: uuid.UUID, aid: uuid.UUID, ctx: HrCtxDep, db: DbSessionDep
) -> dict[str, Any]:
    """HR-ONLY per-question correctness, from the frozen graded_snapshot.

    This is the ONLY endpoint that exposes which answers were right — never the
    applicant take/submit path.
    """
    _hr_uid, company_id = ctx
    await _get_owned_exam(db, company_id, exam_id)
    at = await db.scalar(
        select(ExamAttempt).where(
            ExamAttempt.id == aid,
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.company_id == company_id,
            ExamAttempt.deleted_at.is_(None),
        )
    )
    if at is None:
        raise HTTPException(status_code=404, detail="Attempt not found.")
    snapshot: dict[str, Any] = at.graded_snapshot or {}
    answers: dict[str, int] = {k: int(v) for k, v in (at.answers or {}).items()}
    questions = [
        GradeQuestion(
            question_id=qid,
            correct_index=int(meta.get("correct_index", -1)),
            points=int(meta.get("points", 1)),
        )
        for qid, meta in snapshot.items()
    ]
    per_question = grade_breakdown(GradeInput(questions=questions, answers=answers))
    return {
        "attempt_id": str(at.id),
        "score_percent": at.score_percent,
        "passed": at.passed,
        "per_question": per_question,
    }
