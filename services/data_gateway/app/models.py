"""SQLAlchemy ORM models for data_gateway.

Covers nine migrations:
  20260527_0001 — auth tables (users, roles, user_roles, dpdp_consent_ledger)
  20260527_0418 — interview data model (jobs, nos_competencies, sessions, turns)
  20260529_0001 — DPDP erasure (erasure_requests, audit_log, sessions.deleted_at)
  20260529_0002 — scorecards (scorecards table for S5-006 end-of-session scoring)
  20260529_0004 — interview context fields (B-033: linkedin_url, github_url on
                  users; company_name, department, interview_type on jobs)
  20260529_0005 — resume/JD document columns (B-031/B-032: resume_text,
                  resume_s3_key on users; jd_text, jd_s3_key on jobs)
  20260530_0001 — self-serve custom jobs (created_by_user_id UUID NULL FK→users)
  20260530_0002 — resume version history table (resumes)
  20260530_0003 — session presenter_id column (Area 4 UI redesign v2)
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    NUMERIC,
    TIMESTAMP,
    Boolean,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Auth tables (migration 0001)
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    preferred_language: Mapped[str] = mapped_column(Text, default="en", nullable=False)
    naipunyam_id: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    # B-033 — candidate profile enrichment
    linkedin_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    github_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # B-031 — resume document storage (single-column for B-033 enrichment)
    resume_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    resume_s3_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    user_roles: Mapped[list[UserRole]] = relationship("UserRole", back_populates="user")
    sessions: Mapped[list[Session]] = relationship("Session", back_populates="user")
    consents: Mapped[list[DpdpConsent]] = relationship("DpdpConsent", back_populates="user")
    resumes: Mapped[list[Resume]] = relationship(
        "Resume", back_populates="user", cascade="all, delete-orphan"
    )


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    user_roles: Mapped[list[UserRole]] = relationship("UserRole", back_populates="role")


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    assigned_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))

    user: Mapped[User] = relationship("User", back_populates="user_roles")
    role: Mapped[Role] = relationship("Role", back_populates="user_roles")


class DpdpConsent(Base):
    """DPDP Act 2023 consent ledger entry.

    Maps to the ``dpdp_consent_ledger`` table created by migration 0001.

    consent_type: opaque string identifying what data processing is consented to.
                  For voice recording: "interview_voice_recording".
    granted:      True = consent given; False = consent explicitly denied.
    granted_at:   Timestamp of consent grant (server-set, UTC).
    revoked_at:   NULL while active; set when user withdraws consent.
    purpose:      Human-readable purpose string, e.g. "interview".
    evidence:     JSONB blob — version, ip_hash (sha256), ua_hash (sha256),
                  consented_at_iso. NEVER contains raw PII.
    """

    __tablename__ = "dpdp_consent_ledger"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", name="fk_dpdp_consent_ledger_user_id", ondelete="CASCADE"),
        nullable=False,
    )
    consent_type: Mapped[str] = mapped_column(Text, nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    granted_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="consents")


# ---------------------------------------------------------------------------
# Interview data model (migration 0418)
# ---------------------------------------------------------------------------


class Job(Base):
    """A job role available for interview practice.

    level: 'entry' | 'mid' | 'senior' — validated at application layer.
    language: BCP-47 code, default 'en'. Day-1 values: en, hi, te.
    nos_codes: NSQF NOS codes linked to this job, e.g. ['SSC/N9001'].
    competencies: JSONB blob with required/nice-to-have skill lists.
    """

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # level: entry | mid | senior
    level: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(Text, default="en", nullable=False)
    nos_codes: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)
    competencies: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    # B-033 — role context for smarter interviewing
    company_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    department: Mapped[str | None] = mapped_column(Text, nullable=True)
    # interview_type: 'screening' | 'technical' | 'hr'
    interview_type: Mapped[str] = mapped_column(String(16), default="screening", nullable=False)
    # B-032 — JD document storage
    jd_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    jd_s3_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Self-serve custom jobs — NULL = public/seeded job; set = user-created practice job.
    # FK to users.id ON DELETE SET NULL (orphan stays as a public job if user is deleted).
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", name="fk_jobs_created_by_user_id", ondelete="SET NULL"),
        nullable=True,
    )

    sessions: Mapped[list[Session]] = relationship("Session", back_populates="job")


class NosCompetency(Base):
    """NSQF National Occupational Standards competency record.

    nos_code: unique identifier, e.g. 'SSC/N9001'.
    level: NSQF level 1-9.
    embedding: halfvec(3072) for OpenAI text-embedding-3-large cosine search.
               halfvec uses float16 storage; pgvector 0.8 hnsw supports up to
               4000 halfvec dims vs 2000 for full vector on this build.
               Populated by Sprint 4 NOS ingestion pipeline (nos/embedding.py).
               NULL until ingested. ORM does not map this column — use raw
               SQL / text() for similarity queries.
    """

    __tablename__ = "nos_competencies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # nos_code: e.g. "SSC/N9001" — UNIQUE enforced by DB
    nos_code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # level: NSQF level 1-9
    level: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # embedding stored as opaque column; pgvector handles the type natively.
    # ORM does not map it — access via raw SQL / text() when needed (Sprint 4).
    sector: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))


class Session(Base):
    """An interview session between a user and the AI interviewer.

    status allowed values: 'created' | 'in_progress' | 'completed' |
                           'abandoned' | 'failed'
    Application layer validates via Pydantic; DB stores as Text for flexibility.
    """

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False
    )
    language: Mapped[str] = mapped_column(Text, default="en", nullable=False)
    # status: created | in_progress | completed | abandoned | failed
    status: Mapped[str] = mapped_column(Text, default="created", nullable=False)
    started_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "metadata" is a reserved name on SQLAlchemy's DeclarativeBase; map to
    # the DB column "metadata" via the explicit column name argument.
    session_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, default=dict, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    # Soft-delete column added by migration 20260529_0001 (DPDP erasure).
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    # presenter_id: D-ID stock presenter ID from the PRESENTERS catalog.
    # NULL / default means the baseline presenter ("presenter_alice").
    # Added by migration 20260530_0003.
    presenter_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="sessions")
    job: Mapped[Job] = relationship("Job", back_populates="sessions")
    turns: Mapped[list[Turn]] = relationship(
        "Turn", back_populates="session", cascade="all, delete-orphan"
    )


class Turn(Base):
    """A single conversational turn within an interview session.

    speaker allowed values: 'interviewer' | 'candidate'
    Application layer validates via Pydantic; DB stores as Text for flexibility.

    audio_s3_key: placeholder for Sprint 3 voice pipeline; NULL until voice
                  is integrated.
    prompt_tokens / completion_tokens: LLM token counts for cost tracking.
    latency_ms: end-to-end turn latency for p95 monitoring.
    """

    __tablename__ = "turns"
    __table_args__ = (
        UniqueConstraint("session_id", "turn_number", name="uq_turns_session_turn_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    turn_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # speaker: interviewer | candidate
    speaker: Mapped[str] = mapped_column(Text, nullable=False)
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # audio_s3_key: Sprint 3 placeholder
    audio_s3_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))

    session: Mapped[Session] = relationship("Session", back_populates="turns")


# ---------------------------------------------------------------------------
# Resume version history (migration 20260530_0002)
# ---------------------------------------------------------------------------


class Resume(Base):
    """One uploaded resume version for a user (Area 3, UI redesign v2).

    Each POST /users/me/resume inserts a new row.  The row whose
    ``is_current=True`` is the active resume; users.resume_text and
    users.resume_s3_key mirror it so the B-033 enrichment path keeps working.

    resume_s3_key: versioned key, e.g. ``resumes/{user_id}/{resume_id}.pdf``.
    is_current:    only ONE row per user should have this flag set at a time.
                   Enforced by a partial unique index in the DB migration.
    """

    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", name="fk_resumes_user_id", ondelete="CASCADE"),
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    resume_text: Mapped[str] = mapped_column(Text, nullable=False)
    resume_s3_key: Mapped[str] = mapped_column(Text, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))

    user: Mapped[User] = relationship("User", back_populates="resumes")


# ---------------------------------------------------------------------------
# DPDP erasure tables (migration 20260529_0001)
# ---------------------------------------------------------------------------


class ErasureRequest(Base):
    """DPDP Act 2023 §17 — right-to-erasure request record.

    status allowed values: 'pending' | 'completed' | 'failed'
    Application layer validates; DB stores as VARCHAR(16).

    scheduled_for: 30 days after request creation (standard DPDP grace period).
    requested_by:  user_id of the admin who submitted the erasure request.
    artifacts:     JSONB blob recording what was erased (populated on completion).
    """

    __tablename__ = "erasure_requests"

    request_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", name="fk_erasure_requests_user_id", ondelete="RESTRICT"),
        nullable=False,
    )
    requested_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # status: pending | completed | failed — validated at application layer
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    artifacts: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))

    user: Mapped[User] = relationship("User")


class AuditLog(Base):
    """Immutable audit trail for admin actions.

    Used by DPDP erasure and any other privileged admin operations.

    actor_type allowed values: 'admin' | 'system' | 'user'
    ip_address: PostgreSQL INET type — stored as Python str at ORM layer.
    """

    __tablename__ = "audit_log"

    event_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    actor_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # ip_address uses PostgreSQL INET; mapped as String at ORM layer.
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_ts: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Scorecards (migration 20260529_0002)
# ---------------------------------------------------------------------------


class Scorecard(Base):
    """End-of-session AI scorecard — one row per completed interview session.

    scores:       JSONB with keys communication, technical, problem_solving,
                  confidence (each int 0-10). Populated by the Gemini scorer.
    composite_score: Weighted average of the four axes (see S5-006 formula).
    strengths:    JSONB array of 3 strength strings.
    improvements: JSONB array of 3 {area, suggestion} objects.
    summary:      2-3 sentence overall verdict, calibrated to experience tier.
    lang:         BCP-47 language code, e.g. 'en', 'hi', 'te'.
    report_pdf_key: S3/R2 key for the PDF scorecard (NULL until generated).
    transcript_key: S3/R2 key for the transcript JSON export (NULL until done).
    scorer_model: Gemini model ID used for scoring, e.g. 'gemini-2.5-flash'.
    scorer_version: scorer logic version tag, e.g. '1.0'.
    """

    __tablename__ = "scorecards"
    __table_args__ = (
        UniqueConstraint("session_id", name="uq_scorecards_session_id"),
    )

    scorecard_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    # session_id is intentionally NOT a FK here: scorecards live in
    # feedback_billing while sessions live in interview_core / data_gateway.
    # Cross-service FK enforcement is done at application layer.
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    scores: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    composite_score: Mapped[float | None] = mapped_column(NUMERIC(4, 2), nullable=True)
    strengths: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    improvements: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    lang: Mapped[str] = mapped_column(String(8), nullable=False)
    report_pdf_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    scorer_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scorer_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
