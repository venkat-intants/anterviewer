"""SQLAlchemy ORM models for admin_ops.

admin_ops connects to the same PostgreSQL database as data_gateway and reads
from / writes to the same tables. Rather than importing across service
boundaries (which would require unstable sys.path hacking), this module
defines the minimal set of models that the admin_ops service actually needs,
using identical table names and column definitions.

Tables covered:
  users            — read-access (check existence, soft-delete)
  sessions         — soft-delete on erasure
  erasure_requests — write (INSERT new request, SELECT for duplicate check)
  audit_log        — write (INSERT audit trail entries)
  scorecards       — read-access (analytics, drill-in detail)
  jobs             — read-access (by-role analytics, job title resolution)

All column definitions must stay in sync with:
  data_gateway/app/models.py
  data_gateway/alembic/versions/20260529_0001_c7d8e9f0a1b2_erasure_audit_tables.py
  data_gateway/alembic/versions/20260529_0002_*_scorecards.py
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    NUMERIC,
    TIMESTAMP,
    Boolean,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# users — read-only + soft-delete on erasure
# ---------------------------------------------------------------------------


class User(Base):
    """Mirrors data_gateway users table. Admin_ops only reads and sets deleted_at."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    preferred_language: Mapped[str] = mapped_column(Text, default="en", nullable=False)
    naipunyam_id: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# sessions — soft-delete on erasure
# ---------------------------------------------------------------------------


class Session(Base):
    """Mirrors data_gateway sessions table. Admin_ops sets deleted_at on erasure."""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    language: Mapped[str] = mapped_column(Text, default="en", nullable=False)
    status: Mapped[str] = mapped_column(Text, default="created", nullable=False)
    started_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, default=dict, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    # Added by migration 20260529_0001
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# erasure_requests — DPDP §17 right-to-erasure
# ---------------------------------------------------------------------------


class ErasureRequest(Base):
    """DPDP Act 2023 §17 erasure request record.

    status: 'pending' | 'completed' | 'failed' — validated at application layer.
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
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    artifacts: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))


# ---------------------------------------------------------------------------
# audit_log — immutable admin action trail
# ---------------------------------------------------------------------------


class AuditLog(Base):
    """Immutable audit trail for admin and system actions.

    actor_type: 'admin' | 'system' | 'user'
    ip_address: PostgreSQL INET — mapped as String at ORM layer.
    """

    __tablename__ = "audit_log"

    event_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    actor_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_ts: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# scorecards — read-access for analytics and drill-in detail
# ---------------------------------------------------------------------------


class Scorecard(Base):
    """Mirrors the scorecards table written by feedback_billing.

    scores:           JSONB with keys communication, technical, problem_solving,
                      confidence (each int 0-10).
    composite_score:  Weighted average of the four axes (NUMERIC(4,2)).
    strengths:        JSONB array of 3 strength strings.
    improvements:     JSONB array of 3 {area, suggestion} objects.
    summary:          2-3 sentence overall verdict.
    lang:             BCP-47 language code ('en' | 'hi' | 'te') — note: column
                      is named 'lang', NOT 'language', in the scorecards table.
    scorer_model:     Gemini model ID used for scoring.
    scorer_version:   Scorer logic version tag.

    All column definitions must stay in sync with:
      data_gateway/app/models.py (Scorecard class)
      feedback_billing/app/scorer.py (INSERT statement)
    """

    __tablename__ = "scorecards"
    __table_args__ = (UniqueConstraint("session_id", name="uq_scorecards_session_id"),)

    scorecard_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    scores: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    composite_score: Mapped[float | None] = mapped_column(NUMERIC(4, 2), nullable=True)
    strengths: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    improvements: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    # Column name is 'lang', not 'language' — matches scorecards DDL.
    lang: Mapped[str] = mapped_column(String(8), nullable=False)
    report_pdf_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    scorer_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scorer_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))


# ---------------------------------------------------------------------------
# jobs — read-access for by-role analytics and job title resolution
# ---------------------------------------------------------------------------


class Job(Base):
    """Mirrors the jobs table owned by data_gateway.

    Admin_ops only reads this table (job title resolution, by-role grouping).

    All column definitions must stay in sync with:
      data_gateway/app/models.py (Job class)
    """

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    level: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(Text, default="en", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
