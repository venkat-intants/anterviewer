"""DPDP right-to-erasure executor — S5-004 (enforcement layer).

This module implements the *actual* PII deletion that the erasure endpoint
only schedules.  It runs as an in-process periodic task started during
``lifespan`` startup, and is safe to run on every deployed instance because
it claims rows with ``SELECT … FOR UPDATE SKIP LOCKED`` inside a single
transaction — two concurrent instances never double-process the same request.

Execution model
---------------
Every ``ERASURE_POLL_INTERVAL_SECONDS`` (default 300 s / 5 min) the task
wakes up, opens a session-factory session, and processes any erasure_requests
rows where:
  - status = 'pending'
  - scheduled_for <= NOW() UTC

For each claimed request (one at a time, SKIP LOCKED) it:

  1. Hard-deletes interview transcript turns for the user's sessions
     (via DELETE FROM turns WHERE session_id IN (SELECT id FROM sessions
      WHERE user_id = :uid) — turns.text_content is candidate speech PII).
  2. Hard-deletes resume version rows (resumes table — resume_text is PII).
  3. Anonymises users columns in-place:
       email        → 'erased_{user_id}@deleted.invalid'
       full_name    → '[redacted]'
       phone        → NULL
       resume_text  → NULL
       resume_s3_key → NULL
       password_hash → NULL
       naipunyam_id  → NULL
       linkedin_url  → NULL
       github_url    → NULL
       avatar_url    → NULL
       headline      → NULL
       bio           → NULL
       official_email → NULL
  4. Anonymises applicant rows linked to this user (full_name, email,
     resume_text, resume_s3_key → redacted / NULL; user_id set to NULL).
  5. Hard-deletes scorecards for the user's sessions (scorecard PDF/transcript
     S3 keys are recorded in the artifacts blob for a separate file-purge job).
  6. Hard-deletes the sessions rows themselves (was soft-deleted on request;
     turns are already gone so the cascade is safe, but we delete explicitly).
  7. Marks the erasure_request row: status='completed', completed_at=NOW(),
     artifacts=<summary dict>.
  8. Writes an audit_log entry with action='dpdp_erasure_completed'.

All eight steps happen inside a SINGLE transaction per request.  If any step
raises an exception the transaction is rolled back, the row is left in
'pending' (it will be retried next poll cycle), and the error is logged.

PII safety
----------
- User email / name / phone NEVER appear in any log line.
- Only user_id and request_id appear in log events.
- The executor itself does not log PII at any severity level.

DPDP Act 2023 compliance note
------------------------------
§12(4): erasure must be completed within a "reasonable time" after the grace
period.  This executor fires every 5 minutes so completion happens within 5
minutes of the 30-day scheduled_for timestamp reaching NOW().

Tables NOT reached (flagged for review)
----------------------------------------
- email_events.to_email: contains candidate email, but is linked to the
  internal email outbox (no user_id FK). Purge is handled by the data_gateway
  DPDP §8(7) retention cron (90-day rolling delete). Flagged for manual review
  by security-auditor — admin_ops does not own that table.
- dpdp_consent_ledger: the consent record is the legal basis for processing;
  retaining it (with user_id pointing to an anonymised user) is permissible
  under DPDP §7 to demonstrate prior consent. Flagged for legal review.
- auth_tokens: single-use reset / verification tokens; these expire naturally
  within 24 h. Soft-deleting the user prevents them from being redeemed.
  Flagged for completeness.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import text, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import AuditLog, ErasureRequest

log = structlog.get_logger(__name__)

# How often the executor wakes up and checks for due erasure requests.
# Configurable via the settings object passed at startup.
ERASURE_POLL_INTERVAL_SECONDS: int = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Core erasure logic — executes one erasure request inside an open session
# ---------------------------------------------------------------------------


async def _execute_one_erasure(
    db: AsyncSession,
    request: ErasureRequest,
    system_actor_id: uuid.UUID,
) -> dict[str, Any]:
    """Execute all PII deletion/anonymisation steps for a single erasure request.

    MUST be called inside an already-open session.  The caller owns the
    commit / rollback decision.  Returns an artifacts dict summarising what
    was erased (written to erasure_requests.artifacts on completion).

    Raises SQLAlchemyError on any DB failure — caller rolls back.
    """
    user_id: uuid.UUID = request.user_id
    uid_str = str(user_id)

    # ------------------------------------------------------------------
    # Step 1: Hard-delete interview transcript turns
    # ------------------------------------------------------------------
    turns_result = await db.execute(
        text(
            "DELETE FROM turns "
            "WHERE session_id IN (SELECT id FROM sessions WHERE user_id = :uid)"
        ),
        {"uid": uid_str},
    )
    turns_deleted: int = getattr(turns_result, "rowcount", 0) or 0
    log.info(
        "erasure.executor.turns_deleted",
        user_id=uid_str,
        request_id=str(request.request_id),
        count=turns_deleted,
    )

    # ------------------------------------------------------------------
    # Step 2: Hard-delete resume version rows
    # ------------------------------------------------------------------
    resumes_result = await db.execute(
        text("DELETE FROM resumes WHERE user_id = :uid"),
        {"uid": uid_str},
    )
    resumes_deleted: int = getattr(resumes_result, "rowcount", 0) or 0
    log.info(
        "erasure.executor.resumes_deleted",
        user_id=uid_str,
        request_id=str(request.request_id),
        count=resumes_deleted,
    )

    # ------------------------------------------------------------------
    # Step 3: Collect scorecard S3 keys before deletion (for file-purge)
    # ------------------------------------------------------------------
    scorecard_keys_result = await db.execute(
        text(
            "SELECT report_pdf_key, transcript_key FROM scorecards "
            "WHERE session_id IN (SELECT id FROM sessions WHERE user_id = :uid)"
        ),
        {"uid": uid_str},
    )
    scorecard_keys: list[dict[str, str | None]] = [
        {"pdf": row[0], "transcript": row[1]}
        for row in scorecard_keys_result.fetchall()
    ]

    # ------------------------------------------------------------------
    # Step 4: Hard-delete scorecards
    # ------------------------------------------------------------------
    scorecards_result = await db.execute(
        text(
            "DELETE FROM scorecards "
            "WHERE session_id IN (SELECT id FROM sessions WHERE user_id = :uid)"
        ),
        {"uid": uid_str},
    )
    scorecards_deleted: int = getattr(scorecards_result, "rowcount", 0) or 0
    log.info(
        "erasure.executor.scorecards_deleted",
        user_id=uid_str,
        request_id=str(request.request_id),
        count=scorecards_deleted,
    )

    # ------------------------------------------------------------------
    # Step 5: Hard-delete sessions (was soft-deleted; turns are already gone)
    # ------------------------------------------------------------------
    sessions_result = await db.execute(
        text("DELETE FROM sessions WHERE user_id = :uid"),
        {"uid": uid_str},
    )
    sessions_deleted: int = getattr(sessions_result, "rowcount", 0) or 0
    log.info(
        "erasure.executor.sessions_deleted",
        user_id=uid_str,
        request_id=str(request.request_id),
        count=sessions_deleted,
    )

    # ------------------------------------------------------------------
    # Step 6: Anonymise applicant rows linked to this user_id
    # ------------------------------------------------------------------
    applicants_result = await db.execute(
        text(
            "UPDATE applicants "
            "SET full_name = '[redacted]', "
            "    email = NULL, "
            "    resume_text = NULL, "
            "    resume_s3_key = NULL, "
            "    user_id = NULL, "
            "    updated_at = :now "
            "WHERE user_id = :uid"
        ),
        {"uid": uid_str, "now": datetime.now(UTC)},
    )
    applicants_anonymised: int = getattr(applicants_result, "rowcount", 0) or 0
    log.info(
        "erasure.executor.applicants_anonymised",
        user_id=uid_str,
        request_id=str(request.request_id),
        count=applicants_anonymised,
    )

    # ------------------------------------------------------------------
    # Step 7: Anonymise the users row in-place (email replaced with opaque
    #         sentinel so the UNIQUE constraint remains satisfied and the
    #         FK from erasure_requests does not dangle).
    # ------------------------------------------------------------------
    erased_email_sentinel = f"erased_{uid_str}@deleted.invalid"
    await db.execute(
        text(
            "UPDATE users SET "
            "  email = :sentinel, "
            "  full_name = '[redacted]', "
            "  phone = NULL, "
            "  password_hash = NULL, "
            "  naipunyam_id = NULL, "
            "  linkedin_url = NULL, "
            "  github_url = NULL, "
            "  avatar_url = NULL, "
            "  headline = NULL, "
            "  bio = NULL, "
            "  official_email = NULL, "
            "  resume_text = NULL, "
            "  resume_s3_key = NULL, "
            "  updated_at = :now "
            "WHERE id = :uid"
        ),
        {
            "sentinel": erased_email_sentinel,
            "uid": uid_str,
            "now": datetime.now(UTC),
        },
    )
    log.info(
        "erasure.executor.user_anonymised",
        user_id=uid_str,
        request_id=str(request.request_id),
    )

    # ------------------------------------------------------------------
    # Step 8: Stamp the erasure_request as completed
    # ------------------------------------------------------------------
    now_utc = datetime.now(UTC)
    artifacts: dict[str, Any] = {
        "executor_version": "1.0",
        "completed_at": now_utc.isoformat(),
        "turns_deleted": turns_deleted,
        "resumes_deleted": resumes_deleted,
        "scorecards_deleted": scorecards_deleted,
        "sessions_deleted": sessions_deleted,
        "applicants_anonymised": applicants_anonymised,
        "scorecard_s3_keys": scorecard_keys,
    }
    await db.execute(
        update(ErasureRequest)
        .where(ErasureRequest.request_id == request.request_id)
        .values(
            status="completed",
            completed_at=now_utc,
            artifacts=artifacts,
        )
    )

    # ------------------------------------------------------------------
    # Step 9: Write audit_log entry (action only, zero PII)
    # ------------------------------------------------------------------
    audit_row = AuditLog(
        actor_id=system_actor_id,
        actor_type="system",
        action="dpdp_erasure_completed",
        resource_type="user",
        resource_id=user_id,
        details={
            "request_id": str(request.request_id),
            "turns_deleted": turns_deleted,
            "resumes_deleted": resumes_deleted,
            "scorecards_deleted": scorecards_deleted,
            "sessions_deleted": sessions_deleted,
            "applicants_anonymised": applicants_anonymised,
        },
        ip_address=None,
        user_agent=None,
        event_ts=now_utc,
    )
    db.add(audit_row)

    return artifacts


# ---------------------------------------------------------------------------
# Poll + claim loop — processes ALL due requests in one poll cycle
# ---------------------------------------------------------------------------


async def run_erasure_poll(
    session_factory: async_sessionmaker[AsyncSession],
    system_actor_id: uuid.UUID,
) -> int:
    """Claim and execute all due erasure requests.

    Uses ``SELECT … FOR UPDATE SKIP LOCKED`` so multiple running instances
    never process the same row.  Each request is processed in its own
    transaction so a failure on request N does not roll back request N-1.

    Returns the number of requests successfully completed in this poll cycle.
    """
    completed_count = 0

    # First pass: discover IDs of due requests.  We do a lightweight
    # non-locking query so the discovery read is cheap and does not hold
    # locks across the loop.
    async with session_factory() as discovery_session:
        result = await discovery_session.execute(
            text(
                "SELECT request_id FROM erasure_requests "
                "WHERE status = 'pending' AND scheduled_for <= :now "
                "ORDER BY scheduled_for "
                "LIMIT 100"
            ),
            {"now": datetime.now(UTC)},
        )
        candidate_ids: list[str] = [str(row[0]) for row in result.fetchall()]

    if not candidate_ids:
        return 0

    log.info(
        "erasure.executor.poll_found",
        candidate_count=len(candidate_ids),
    )

    for rid_str in candidate_ids:
        # Each request gets its own transaction with FOR UPDATE SKIP LOCKED
        # so two instances do not race on the same row.
        async with session_factory() as db:
            try:
                # Claim the row atomically — skip if already locked by a
                # sibling instance.
                claim_result = await db.execute(
                    text(
                        "SELECT request_id, user_id, status "
                        "FROM erasure_requests "
                        "WHERE request_id = :rid "
                        "  AND status = 'pending' "
                        "  AND scheduled_for <= :now "
                        "FOR UPDATE SKIP LOCKED"
                    ),
                    {"rid": rid_str, "now": datetime.now(UTC)},
                )
                row = claim_result.fetchone()
                if row is None:
                    # Already claimed by another instance or no longer pending.
                    log.info(
                        "erasure.executor.row_skipped",
                        request_id=rid_str,
                        reason="locked_or_stale",
                    )
                    continue

                # Reload the full ORM object (we have the lock now).
                req_result = await db.execute(
                    text(
                        "SELECT request_id, user_id, requested_by, reason, "
                        "status, scheduled_for, completed_at, artifacts, created_at "
                        "FROM erasure_requests WHERE request_id = :rid"
                    ),
                    {"rid": rid_str},
                )
                req_row = req_result.fetchone()
                if req_row is None:
                    continue

                # Build a lightweight ErasureRequest-like object.
                er = ErasureRequest(
                    request_id=uuid.UUID(str(req_row[0])),
                    user_id=uuid.UUID(str(req_row[1])),
                    requested_by=uuid.UUID(str(req_row[2])),
                    reason=req_row[3],
                    status=req_row[4],
                    scheduled_for=req_row[5],
                    completed_at=req_row[6],
                    artifacts=req_row[7],
                    created_at=req_row[8],
                )

                await _execute_one_erasure(
                    db=db,
                    request=er,
                    system_actor_id=system_actor_id,
                )
                await db.commit()
                completed_count += 1
                log.info(
                    "erasure.executor.request_completed",
                    request_id=rid_str,
                    user_id=str(er.user_id),
                )

            except SQLAlchemyError as exc:
                await db.rollback()
                log.error(
                    "erasure.executor.request_failed",
                    request_id=rid_str,
                    exc_type=type(exc).__name__,
                    exc_msg=str(exc),
                )
            except Exception as exc:  # noqa: BLE001 — broad catch to never kill the loop
                await db.rollback()
                log.error(
                    "erasure.executor.unexpected_error",
                    request_id=rid_str,
                    exc_type=type(exc).__name__,
                    exc_msg=str(exc),
                )

    return completed_count


# ---------------------------------------------------------------------------
# Background task — runs forever, sleeping between poll cycles
# ---------------------------------------------------------------------------


async def erasure_executor_task(
    session_factory: async_sessionmaker[AsyncSession],
    poll_interval_seconds: int = ERASURE_POLL_INTERVAL_SECONDS,
    system_actor_id: uuid.UUID | None = None,
) -> None:
    """Async background task suitable for ``asyncio.create_task()``.

    Runs indefinitely until cancelled (e.g. on app shutdown).
    Sleeps between poll cycles — does NOT busy-wait.

    Args:
        session_factory: The admin_ops async session factory.
        poll_interval_seconds: Seconds to sleep between poll cycles.
        system_actor_id: UUID used as actor_id in audit_log entries.
                         Defaults to a stable nil-adjacent sentinel UUID.
    """
    actor = system_actor_id or uuid.UUID("00000000-0000-0000-0000-000000000001")
    log.info(
        "erasure.executor.started",
        poll_interval_seconds=poll_interval_seconds,
        system_actor_id=str(actor),
    )
    while True:
        try:
            completed = await run_erasure_poll(
                session_factory=session_factory,
                system_actor_id=actor,
            )
            if completed:
                log.info(
                    "erasure.executor.cycle_complete",
                    completed=completed,
                )
        except asyncio.CancelledError:
            log.info("erasure.executor.cancelled")
            raise
        except Exception as exc:  # noqa: BLE001 — polling errors must not kill the task
            log.error(
                "erasure.executor.poll_error",
                exc_type=type(exc).__name__,
                exc_msg=str(exc),
            )
        await asyncio.sleep(poll_interval_seconds)
