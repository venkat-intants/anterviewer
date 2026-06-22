"""Applicant exam-taking — HR workflow Phase 2 (PUBLIC, no login).

An applicant opens a magic link and takes an exam WITHOUT an account. Auth is the
opaque token, sent in the ``X-Exam-Token`` header (never the URL path/query — the
HR mint puts it in the URL *fragment*, which browsers don't send to servers or
leak via Referer). Every request re-resolves the assignment row by token hash and
re-checks tenant + status + expiry, so revocation is immediate.

HARD SECURITY GUARANTEES:
  - correct_index / pass_threshold are NEVER in any response on this router.
  - Grading is 100% server-side; the client only submits chosen indices.
  - The time limit is enforced on the SERVER at submit (client countdown is UX).
  - Submit is idempotent; a second submit returns the stored result (no re-grade).
  - One live attempt per applicant+exam (DB partial-unique index); a retake is
    allowed only when the exam permits it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.exam_grading import GradeInput, GradeQuestion, grade_exam
from app.exam_link import hash_exam_token
from app.models import Applicant, Exam, ExamAssignment, ExamAttempt, ExamQuestion
from app.routers.hr_applicants import DbSessionDep

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/exam", tags=["exam-take"])

_NOT_AVAILABLE = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not available.")


# ---------------------------------------------------------------------------
# Magic-link resolution (the applicant's only auth)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ExamTakeCtx:
    company_id: uuid.UUID
    exam: Exam
    applicant: Applicant
    assignment: ExamAssignment


async def get_exam_link_ctx(
    db: DbSessionDep,
    x_exam_token: Annotated[str | None, Header(alias="X-Exam-Token")] = None,
) -> ExamTakeCtx:
    """Resolve + validate a magic link. Always 404 on any failure (never reveals
    whether a link/exam exists — mirrors the HR-side _get_owned 404 behaviour)."""
    if not x_exam_token:
        raise _NOT_AVAILABLE
    token_hash = hash_exam_token(x_exam_token, settings.exam_link_secret)
    asn = await db.scalar(
        select(ExamAssignment).where(
            ExamAssignment.token_hash == token_hash,
            ExamAssignment.deleted_at.is_(None),
            ExamAssignment.status.notin_(("revoked", "expired")),
            ExamAssignment.expires_at > datetime.now(tz=UTC),
        )
    )
    if asn is None:
        raise _NOT_AVAILABLE
    exam = await db.scalar(
        select(Exam).where(
            Exam.id == asn.exam_id,
            Exam.company_id == asn.company_id,
            Exam.status == "published",
            Exam.deleted_at.is_(None),
        )
    )
    applicant = await db.scalar(
        select(Applicant).where(
            Applicant.id == asn.applicant_id,
            Applicant.company_id == asn.company_id,
            Applicant.deleted_at.is_(None),
        )
    )
    if exam is None or applicant is None:
        raise _NOT_AVAILABLE
    return ExamTakeCtx(company_id=asn.company_id, exam=exam, applicant=applicant, assignment=asn)


ExamTakeCtxDep = Annotated[ExamTakeCtx, Depends(get_exam_link_ctx)]


# ---------------------------------------------------------------------------
# Schemas (NO correct_index / pass_threshold anywhere here)
# ---------------------------------------------------------------------------
class PublicQuestionOut(BaseModel):
    id: str
    position: int
    prompt: str
    options: list[str]
    points: int


class TakeExamOut(BaseModel):
    exam_id: str
    title: str
    description: str | None
    time_limit_seconds: int | None
    total_questions: int
    allow_retake: bool
    already_submitted: bool
    server_now: str
    deadline: str | None
    questions: list[PublicQuestionOut]


class AttemptStartOut(BaseModel):
    attempt_id: str
    started_at: str
    deadline: str | None


class SubmitIn(BaseModel):
    attempt_id: uuid.UUID
    answers: dict[str, int] = Field(default_factory=dict)

    @field_validator("answers")
    @classmethod
    def _cap_answers(cls, v: dict[str, int]) -> dict[str, int]:
        if len(v) > settings.exam_max_answers:
            raise ValueError("too many answers")
        return v


class ExamResultOut(BaseModel):
    attempt_id: str
    score_raw: int
    score_max: int
    score_percent: int
    passed: bool
    status: str
    submitted_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _live_questions(db: AsyncSession, ctx: ExamTakeCtx) -> list[ExamQuestion]:
    rows = (
        await db.execute(
            select(ExamQuestion)
            .where(
                ExamQuestion.exam_id == ctx.exam.id,
                ExamQuestion.company_id == ctx.company_id,
                ExamQuestion.deleted_at.is_(None),
            )
            .order_by(ExamQuestion.position.asc())
        )
    ).scalars().all()
    return list(rows)


async def _in_progress_attempt(db: AsyncSession, ctx: ExamTakeCtx) -> ExamAttempt | None:
    return await db.scalar(
        select(ExamAttempt).where(
            ExamAttempt.exam_id == ctx.exam.id,
            ExamAttempt.applicant_id == ctx.applicant.id,
            ExamAttempt.company_id == ctx.company_id,
            ExamAttempt.status == "in_progress",
            ExamAttempt.deleted_at.is_(None),
        )
    )


async def _has_submitted(db: AsyncSession, ctx: ExamTakeCtx) -> bool:
    n = await db.scalar(
        select(func.count()).select_from(ExamAttempt).where(
            ExamAttempt.exam_id == ctx.exam.id,
            ExamAttempt.applicant_id == ctx.applicant.id,
            ExamAttempt.company_id == ctx.company_id,
            ExamAttempt.status == "submitted",
            ExamAttempt.deleted_at.is_(None),
        )
    )
    return int(n or 0) > 0


def _deadline(exam: Exam, started_at: datetime) -> datetime | None:
    if exam.time_limit_seconds is None:
        return None
    return started_at + timedelta(seconds=exam.time_limit_seconds)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("", response_model=TakeExamOut)
async def get_take_exam(ctx: ExamTakeCtxDep, db: DbSessionDep) -> TakeExamOut:
    questions = await _live_questions(db, ctx)
    in_prog = await _in_progress_attempt(db, ctx)
    deadline = _deadline(ctx.exam, in_prog.started_at) if in_prog else None
    return TakeExamOut(
        exam_id=str(ctx.exam.id),
        title=ctx.exam.title,
        description=ctx.exam.description,
        time_limit_seconds=ctx.exam.time_limit_seconds,
        total_questions=len(questions),
        allow_retake=ctx.exam.allow_retake,
        already_submitted=await _has_submitted(db, ctx),
        server_now=datetime.now(tz=UTC).isoformat(),
        deadline=deadline.isoformat() if deadline else None,
        questions=[
            PublicQuestionOut(
                id=str(q.id),
                position=q.position,
                prompt=q.prompt,
                options=list(q.options or []),
                points=q.points,
            )
            for q in questions
        ],
    )


@router.post("/start", response_model=AttemptStartOut)
async def start_attempt(ctx: ExamTakeCtxDep, db: DbSessionDep) -> AttemptStartOut:
    # Idempotent: return the existing in-progress attempt if one is open.
    existing = await _in_progress_attempt(db, ctx)
    if existing is not None:
        d = _deadline(ctx.exam, existing.started_at)
        return AttemptStartOut(
            attempt_id=str(existing.id),
            started_at=existing.started_at.isoformat(),
            deadline=d.isoformat() if d else None,
        )
    # Block a fresh attempt on a single-shot exam already submitted.
    if await _has_submitted(db, ctx) and not ctx.exam.allow_retake:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You have already taken this exam."
        )

    now = datetime.now(tz=UTC)
    max_no = await db.scalar(
        select(func.max(ExamAttempt.attempt_no)).where(
            ExamAttempt.exam_id == ctx.exam.id,
            ExamAttempt.applicant_id == ctx.applicant.id,
            ExamAttempt.company_id == ctx.company_id,
        )
    )
    attempt = ExamAttempt(
        id=uuid.uuid4(),
        company_id=ctx.company_id,
        exam_id=ctx.exam.id,
        applicant_id=ctx.applicant.id,
        assignment_id=ctx.assignment.id,
        attempt_no=(int(max_no) + 1) if max_no is not None else 1,
        status="in_progress",
        started_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(attempt)
    if ctx.assignment.status == "invited":
        ctx.assignment.status = "started"
        ctx.assignment.updated_at = now
    try:
        await db.commit()
    except IntegrityError:
        # Concurrent /start lost the race against uix_exam_attempts_one_live —
        # fall back to the attempt the winner created.
        await db.rollback()
        existing = await _in_progress_attempt(db, ctx)
        if existing is None:
            raise
        d = _deadline(ctx.exam, existing.started_at)
        return AttemptStartOut(
            attempt_id=str(existing.id),
            started_at=existing.started_at.isoformat(),
            deadline=d.isoformat() if d else None,
        )
    d = _deadline(ctx.exam, attempt.started_at)
    return AttemptStartOut(
        attempt_id=str(attempt.id),
        started_at=attempt.started_at.isoformat(),
        deadline=d.isoformat() if d else None,
    )


@router.post("/submit", response_model=ExamResultOut)
async def submit_attempt(body: SubmitIn, ctx: ExamTakeCtxDep, db: DbSessionDep) -> ExamResultOut:
    attempt = await db.scalar(
        select(ExamAttempt).where(
            ExamAttempt.id == body.attempt_id,
            ExamAttempt.exam_id == ctx.exam.id,
            ExamAttempt.applicant_id == ctx.applicant.id,
            ExamAttempt.company_id == ctx.company_id,
            ExamAttempt.deleted_at.is_(None),
        )
    )
    if attempt is None:
        raise _NOT_AVAILABLE

    # Idempotent: a finished attempt returns its stored result (no re-grade).
    if attempt.status in ("submitted", "expired") and attempt.score_percent is not None:
        return ExamResultOut(
            attempt_id=str(attempt.id),
            score_raw=attempt.score_raw or 0,
            score_max=attempt.score_max or 0,
            score_percent=attempt.score_percent,
            passed=bool(attempt.passed),
            status=attempt.status,
            submitted_at=(attempt.submitted_at or attempt.started_at).isoformat(),
        )

    now = datetime.now(tz=UTC)
    # Server-side time enforcement — the client countdown is advisory only.
    deadline = _deadline(ctx.exam, attempt.started_at)
    expired = bool(
        deadline and now > deadline + timedelta(seconds=settings.exam_submit_grace_seconds)
    )

    questions = await _live_questions(db, ctx)
    grade_questions = [
        GradeQuestion(question_id=str(q.id), correct_index=q.correct_index, points=q.points)
        for q in questions
    ]
    answers = {k: int(v) for k, v in body.answers.items()}
    result = grade_exam(
        GradeInput(questions=grade_questions, answers=answers), ctx.exam.pass_threshold
    )

    attempt.answers = answers
    # Freeze the answer key + weights so later edits never alter this grade/audit.
    attempt.graded_snapshot = {
        str(q.id): {"correct_index": q.correct_index, "points": q.points} for q in questions
    }
    attempt.score_raw = result.score_raw
    attempt.score_max = result.score_max
    attempt.score_percent = result.score_percent
    attempt.passed = result.passed
    attempt.status = "expired" if expired else "submitted"
    attempt.submitted_at = now
    attempt.updated_at = now

    # Close the assignment (single-use): the link is consumed.
    ctx.assignment.status = "completed"
    ctx.assignment.consumed_at = now
    ctx.assignment.updated_at = now
    await db.commit()

    log.info(
        "exam.submitted",
        exam_id=str(ctx.exam.id),
        company_id=str(ctx.company_id),
        percent=result.score_percent,
        passed=result.passed,
        expired=expired,
    )
    return ExamResultOut(
        attempt_id=str(attempt.id),
        score_raw=result.score_raw,
        score_max=result.score_max,
        score_percent=result.score_percent,
        passed=result.passed,
        status=attempt.status,
        submitted_at=now.isoformat(),
    )
