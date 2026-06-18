"""90-day retention purge — DPDP §8(7) compliance.

Daily job (APScheduler) that deletes session + turn rows older than
``settings.retention_days`` from their ``completed_at`` timestamp.

Scope (what gets purged):
  - sessions WHERE status='completed' AND completed_at < NOW() - INTERVAL N days
  - turns CASCADE via FK (ON DELETE CASCADE on turns.session_id — confirmed in
    migration eda3829ec95a, fk_turns_session_id with ondelete='CASCADE')
  - audio recordings — separate concern; tracked when blob storage lands (Sprint 5)

Out of scope (what is NEVER deleted by this job):
  - dpdp_consent_ledger rows (legal audit trail per DPDP §8(7) — remain indefinitely
    or until a user-initiated §11 erasure request, task #46)
  - users (auth/identity — separate lifecycle)
  - jobs / NOS catalogue (reference data — no retention requirement)
  - sessions in non-terminal states: 'created', 'in_progress', 'abandoned', 'failed'
    (only 'completed' sessions have a meaningful completed_at timestamp and fall
    under the recording-retention promise in the ConsentModal)

Safety rail:
  settings.retention_dry_run defaults to True.  In dry-run mode the job SELECTs
  the rows that WOULD be deleted and logs the count, but issues no DELETE statement.
  Operators MUST explicitly set RETENTION_DRY_RUN=false in production after a
  dry-run cycle confirms expected delete counts.

Log events emitted:
  retention.purge.done   — one event per run; carries deleted_count, dry_run,
                           cutoff_iso, retention_days.  Never logs individual
                           session IDs or user IDs (purge of 1000 rows should
                           not produce 1000 PII-adjacent log lines).
  retention.purge.error  — unexpected exception; carries exc_type, exc_msg.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import Session as InterviewSession

log = structlog.get_logger(__name__)


async def purge_expired_sessions(db: AsyncSession, settings: Settings) -> int:
    """Delete (or dry-run count) completed sessions older than retention_days.

    Args:
        db:       An open AsyncSession.  Caller is responsible for commit/close.
        settings: The application settings object providing retention_days,
                  retention_dry_run.

    Returns:
        The number of session rows that were deleted (live mode) or that WOULD
        have been deleted (dry-run mode).

    Raises:
        Propagates any SQLAlchemy / DB exceptions to the caller for structured
        logging at the scheduler wrapper level.
    """
    cutoff: datetime = datetime.now(tz=UTC) - timedelta(days=settings.retention_days)
    cutoff_iso: str = cutoff.isoformat()

    if settings.retention_dry_run:
        # Dry-run: count matching rows without touching them.
        count_stmt = (
            select(func.count(InterviewSession.id))
            .where(
                InterviewSession.status == "completed",
                InterviewSession.completed_at.isnot(None),
                InterviewSession.completed_at < cutoff,
            )
        )
        result = await db.execute(count_stmt)
        deleted_count: int = int(result.scalar_one())

        log.info(
            "retention.purge.done",
            deleted_count=deleted_count,
            dry_run=True,
            cutoff_iso=cutoff_iso,
            retention_days=settings.retention_days,
        )
        return deleted_count

    # Live mode: issue the parametrised DELETE.
    # turns rows are removed via ON DELETE CASCADE (fk_turns_session_id).
    delete_stmt = delete(InterviewSession).where(
        InterviewSession.status == "completed",
        InterviewSession.completed_at.isnot(None),
        InterviewSession.completed_at < cutoff,
    )
    result = await db.execute(delete_stmt)
    await db.commit()
    deleted_count = int(result.rowcount)

    log.info(
        "retention.purge.done",
        deleted_count=deleted_count,
        dry_run=False,
        cutoff_iso=cutoff_iso,
        retention_days=settings.retention_days,
    )
    return deleted_count
