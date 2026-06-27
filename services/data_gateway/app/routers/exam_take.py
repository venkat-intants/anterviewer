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

from app.coding_grader import run_tests, weighted_raw
from app.config import settings
from app.exam_grading import GradeInput, GradeQuestion, grade_exam
from app.exam_link import hash_exam_token
from app.models import (
    Applicant,
    CodingQuestion,
    Exam,
    ExamAssignment,
    ExamAttempt,
    ExamQuestion,
)
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


class PublicSampleTest(BaseModel):
    """A SAMPLE test case shown to the candidate (hidden cases never appear here)."""

    stdin: str
    expected_output: str


class PublicCodingQuestionOut(BaseModel):
    """Candidate-facing coding question. NEVER carries reference_solution or any
    hidden test case's expected_output (mirrors how MCQ hides correct_index)."""

    id: str
    position: int
    prompt: str
    starter_code: str | None
    allowed_languages: list[str]
    points: int
    time_limit_ms: int
    sample_tests: list[PublicSampleTest]


class TakeExamOut(BaseModel):
    exam_id: str
    title: str
    description: str | None
    kind: str = "mcq"
    time_limit_seconds: int | None
    total_questions: int
    allow_retake: bool
    already_submitted: bool
    server_now: str
    deadline: str | None
    questions: list[PublicQuestionOut]
    coding_questions: list[PublicCodingQuestionOut] = Field(default_factory=list)


class RunCodeIn(BaseModel):
    """Candidate's 'Run' against the SAMPLE tests (no scoring, no persistence)."""

    question_id: uuid.UUID
    language: str = Field(min_length=1, max_length=40)
    source: str = Field(default="")

    @field_validator("source")
    @classmethod
    def _cap_source(cls, v: str) -> str:
        if len(v.encode("utf-8", "ignore")) > settings.code_max_source_bytes:
            raise ValueError("source too large")
        return v


class PublicTestResult(BaseModel):
    index: int
    passed: bool
    stdin: str
    expected_output: str
    actual_output: str
    stderr: str
    timed_out: bool
    error: str | None = None


class RunCodeOut(BaseModel):
    results: list[PublicTestResult]


class CodingAnswer(BaseModel):
    language: str = Field(min_length=1, max_length=40)
    source: str = Field(default="")

    @field_validator("source")
    @classmethod
    def _cap_source(cls, v: str) -> str:
        if len(v.encode("utf-8", "ignore")) > settings.code_max_source_bytes:
            raise ValueError("source too large")
        return v


class CodingSubmitIn(BaseModel):
    attempt_id: uuid.UUID
    submissions: dict[str, CodingAnswer] = Field(default_factory=dict)

    @field_validator("submissions")
    @classmethod
    def _cap_submissions(cls, v: dict[str, CodingAnswer]) -> dict[str, CodingAnswer]:
        if len(v) > settings.code_max_questions_per_exam:
            raise ValueError("too many submissions")
        return v


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


async def _live_coding_questions(db: AsyncSession, ctx: ExamTakeCtx) -> list[CodingQuestion]:
    rows = (
        await db.execute(
            select(CodingQuestion)
            .where(
                CodingQuestion.exam_id == ctx.exam.id,
                CodingQuestion.company_id == ctx.company_id,
                CodingQuestion.deleted_at.is_(None),
            )
            .order_by(CodingQuestion.position.asc())
        )
    ).scalars().all()
    return list(rows)


def _public_coding_question(q: CodingQuestion) -> PublicCodingQuestionOut:
    """Serialize a coding question for the candidate — sample tests ONLY, never
    the reference_solution or any hidden test case's expected_output."""
    samples = [
        PublicSampleTest(
            stdin=str(tc.get("stdin") or ""),
            expected_output=str(tc.get("expected_output") or ""),
        )
        for tc in (q.test_cases or [])
        if bool(tc.get("is_sample"))
    ]
    return PublicCodingQuestionOut(
        id=str(q.id),
        position=q.position,
        prompt=q.prompt,
        starter_code=q.starter_code,
        allowed_languages=list(q.allowed_languages or []),
        points=q.points,
        time_limit_ms=q.time_limit_ms,
        sample_tests=samples,
    )


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
    is_coding = ctx.exam.kind == "coding"
    mcq = [] if is_coding else await _live_questions(db, ctx)
    coding = await _live_coding_questions(db, ctx) if is_coding else []
    in_prog = await _in_progress_attempt(db, ctx)
    deadline = _deadline(ctx.exam, in_prog.started_at) if in_prog else None
    return TakeExamOut(
        exam_id=str(ctx.exam.id),
        title=ctx.exam.title,
        description=ctx.exam.description,
        kind=ctx.exam.kind,
        time_limit_seconds=ctx.exam.time_limit_seconds,
        total_questions=len(coding) if is_coding else len(mcq),
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
            for q in mcq
        ],
        coding_questions=[_public_coding_question(q) for q in coding],
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
    # MCQ submit only — a coding exam must use /exam/submit-coding.
    if ctx.exam.kind != "mcq":
        raise _NOT_AVAILABLE
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


# ---------------------------------------------------------------------------
# Coding round (exams.kind == 'coding') — run samples + submit/grade via Piston
# ---------------------------------------------------------------------------
async def _owned_coding_question(
    db: AsyncSession, ctx: ExamTakeCtx, qid: uuid.UUID
) -> CodingQuestion | None:
    return await db.scalar(
        select(CodingQuestion).where(
            CodingQuestion.id == qid,
            CodingQuestion.exam_id == ctx.exam.id,
            CodingQuestion.company_id == ctx.company_id,
            CodingQuestion.deleted_at.is_(None),
        )
    )


@router.post("/run-code", response_model=RunCodeOut)
async def run_code_samples(body: RunCodeIn, ctx: ExamTakeCtxDep, db: DbSessionDep) -> RunCodeOut:
    """Candidate 'Run' — execute against the SAMPLE tests only. No score, no save."""
    if ctx.exam.kind != "coding":
        raise _NOT_AVAILABLE
    # Require an open attempt — no anonymous Piston runs before /start (DoS guard).
    if await _in_progress_attempt(db, ctx) is None:
        raise _NOT_AVAILABLE
    q = await _owned_coding_question(db, ctx, body.question_id)
    if q is None:
        raise _NOT_AVAILABLE
    if body.language not in (q.allowed_languages or []):
        raise HTTPException(status_code=400, detail="Language not allowed for this question.")
    results = await run_tests(
        language=body.language,
        source=body.source,
        test_cases=list(q.test_cases or []),
        time_limit_ms=q.time_limit_ms,
        include_hidden=False,
    )
    return RunCodeOut(
        results=[
            PublicTestResult(
                index=r.index,
                passed=r.passed,
                stdin=r.stdin,
                expected_output=r.expected_output,
                actual_output=r.actual_output,
                stderr=r.stderr,
                timed_out=r.timed_out,
                error=r.error,
            )
            for r in results
        ]
    )


@router.post("/submit-coding", response_model=ExamResultOut)
async def submit_coding(
    body: CodingSubmitIn, ctx: ExamTakeCtxDep, db: DbSessionDep
) -> ExamResultOut:
    """Grade a coding attempt: run each question's source against ALL test cases
    (Piston) and store a weighted score on the SAME exam_attempts row MCQ uses."""
    if ctx.exam.kind != "coding":
        raise _NOT_AVAILABLE
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

    # Idempotent: a finished attempt returns its stored result and NEVER re-grades
    # — code execution is expensive, so a re-submit must not trigger a second Piston
    # run even if a prior grade crashed mid-write (score_percent left NULL).
    if attempt.status in ("submitted", "expired"):
        return ExamResultOut(
            attempt_id=str(attempt.id),
            score_raw=attempt.score_raw or 0,
            score_max=attempt.score_max or 0,
            score_percent=attempt.score_percent or 0,
            passed=bool(attempt.passed),
            status=attempt.status,
            submitted_at=(attempt.submitted_at or attempt.started_at).isoformat(),
        )

    now = datetime.now(tz=UTC)
    deadline = _deadline(ctx.exam, attempt.started_at)
    expired = bool(
        deadline and now > deadline + timedelta(seconds=settings.exam_submit_grace_seconds)
    )

    questions = await _live_coding_questions(db, ctx)
    total_raw = 0
    total_max = 0
    snapshot: dict[str, object] = {}
    sanitized: dict[str, object] = {}
    for q in questions:
        total_max += q.points
        qid = str(q.id)
        sub = body.submissions.get(qid)
        if sub is None:
            snapshot[qid] = {"points": q.points, "submitted": False, "raw": 0, "tests": []}
            continue
        sanitized[qid] = {"language": sub.language, "source": sub.source}
        if sub.language not in (q.allowed_languages or []):
            snapshot[qid] = {
                "points": q.points, "language": sub.language,
                "error": "language not allowed", "raw": 0, "tests": [],
            }
            continue
        results = await run_tests(
            language=sub.language,
            source=sub.source,
            test_cases=list(q.test_cases or []),
            time_limit_ms=q.time_limit_ms,
            include_hidden=True,
        )
        raw = weighted_raw(results, q.points)
        total_raw += raw
        snapshot[qid] = {
            "points": q.points,
            "language": sub.language,
            "raw": raw,
            "tests": [
                {
                    "index": r.index, "is_sample": r.is_sample, "weight": r.weight,
                    "passed": r.passed, "timed_out": r.timed_out, "error": r.error,
                    "actual_output": r.actual_output, "stderr": r.stderr,
                }
                for r in results
            ],
        }

    # round() to match the MCQ grader (grade_exam), so percent is consistent
    # across exam kinds for the same raw/max.
    percent = round(100 * total_raw / total_max) if total_max > 0 else 0
    passed = percent >= ctx.exam.pass_threshold

    attempt.answers = sanitized
    attempt.graded_snapshot = snapshot
    attempt.score_raw = total_raw
    attempt.score_max = total_max
    attempt.score_percent = percent
    attempt.passed = passed
    attempt.status = "expired" if expired else "submitted"
    attempt.submitted_at = now
    attempt.updated_at = now

    ctx.assignment.status = "completed"
    ctx.assignment.consumed_at = now
    ctx.assignment.updated_at = now
    await db.commit()

    log.info(
        "exam.coding.submitted",
        exam_id=str(ctx.exam.id),
        company_id=str(ctx.company_id),
        percent=percent,
        passed=passed,
        expired=expired,
    )
    return ExamResultOut(
        attempt_id=str(attempt.id),
        score_raw=total_raw,
        score_max=total_max,
        score_percent=percent,
        passed=passed,
        status=attempt.status,
        submitted_at=now.isoformat(),
    )
