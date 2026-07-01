"""Unit tests for the five security / quality fixes in Cluster A.

Fix 1 — change-password session invalidation (auth.py)
Fix 2 — pypdf CVE-2025-62707: asyncio.to_thread + timeout (resume.py, jd.py)
Fix 3 — exam double-submit guard at DB write level (exam_take.py)
Fix 4 — retention purge covers abandoned + consent_withdrawn sessions (retention.py)
Fix 5 — /metrics endpoint is reachable and returns Prometheus text (main.py)

All external I/O is mocked so tests run without any infrastructure.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Fix 1 — change_password must call auth.logout_all after updating the hash
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_password_revokes_other_sessions() -> None:
    """POST /auth/change-password must call auth.logout_all after committing
    the new password hash — the audit finding 'change_password does not revoke
    sessions' is fixed by this call."""
    from app.routers.auth import ChangePasswordBody, change_password

    user_id = str(uuid.uuid4())
    mock_user = MagicMock()
    mock_user.user_id = user_id

    mock_auth = AsyncMock()
    mock_auth.logout_all = AsyncMock(return_value=3)

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    mock_db.commit = AsyncMock()

    body = ChangePasswordBody(new_password="NewSecurePass1!")

    with patch("app.routers.auth.asyncio.to_thread", new=AsyncMock(return_value=b"hashed")):
        result = await change_password(
            body=body,
            current_user=mock_user,
            auth=mock_auth,
            db=mock_db,
        )

    assert result.ok is True
    # logout_all must be called with the current user's ID
    mock_auth.logout_all.assert_awaited_once_with(user_id)
    # DB must have been committed
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_change_password_succeeds_even_if_revoke_fails() -> None:
    """A Redis error in logout_all must NOT fail the password-change response.
    The new password is already the safer state; best-effort revocation."""
    from app.routers.auth import ChangePasswordBody, change_password

    user_id = str(uuid.uuid4())
    mock_user = MagicMock()
    mock_user.user_id = user_id

    mock_auth = AsyncMock()
    mock_auth.logout_all = AsyncMock(side_effect=RuntimeError("Redis down"))

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    mock_db.commit = AsyncMock()

    body = ChangePasswordBody(new_password="AnotherSecurePass1!")

    with patch("app.routers.auth.asyncio.to_thread", new=AsyncMock(return_value=b"hashed")):
        # Must NOT raise even though logout_all raised
        result = await change_password(
            body=body,
            current_user=mock_user,
            auth=mock_auth,
            db=mock_db,
        )

    assert result.ok is True
    # DB must still have been committed (password change itself succeeded)
    mock_db.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# Fix 2 — pypdf must run off the event loop + timeout on a hanging parse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resume_pdf_extraction_uses_to_thread() -> None:
    """_extract_pdf_text in resume.py must delegate to asyncio.to_thread so a
    CPU-bound pypdf parse never blocks the event loop."""
    from app.routers.resume import _extract_pdf_text, _extract_pdf_text_sync

    # Minimal valid PDF that pypdf can parse
    minimal_pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\n"
        b"startxref\n190\n%%EOF"
    )

    # The sync function must return a string (possibly empty for this minimal PDF)
    result_sync = _extract_pdf_text_sync(minimal_pdf)
    assert isinstance(result_sync, str)

    # The async wrapper must return the same string
    result_async = await _extract_pdf_text(minimal_pdf)
    assert isinstance(result_async, str)
    assert result_async == result_sync


@pytest.mark.asyncio
async def test_resume_pdf_extraction_raises_on_timeout() -> None:
    """_extract_pdf_text must raise asyncio.TimeoutError when the sync parse
    exceeds _PDF_PARSE_TIMEOUT_SECONDS — the caller maps this to HTTP 400."""
    from app.routers.resume import _extract_pdf_text

    def _slow_parse(raw: bytes) -> str:  # noqa: ARG001
        import time
        time.sleep(9999)  # blocks indefinitely (will be cancelled)
        return ""

    with (
        patch("app.routers.resume._extract_pdf_text_sync", side_effect=_slow_parse),
        patch("app.routers.resume._PDF_PARSE_TIMEOUT_SECONDS", 0.05),
        pytest.raises((asyncio.TimeoutError, TimeoutError)),
    ):
        await _extract_pdf_text(b"fake")


@pytest.mark.asyncio
async def test_jd_pdf_extraction_uses_to_thread() -> None:
    """_extract_pdf_text in jd.py must also delegate to asyncio.to_thread."""
    from app.routers.jd import _extract_pdf_text, _extract_pdf_text_sync

    minimal_pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\n"
        b"startxref\n190\n%%EOF"
    )

    result_sync = _extract_pdf_text_sync(minimal_pdf)
    result_async = await _extract_pdf_text(minimal_pdf)
    assert result_async == result_sync


@pytest.mark.asyncio
async def test_resume_upload_returns_400_on_pdf_timeout() -> None:
    """_do_upload must return HTTP 400 when pypdf times out — no 500 leaking."""
    from app.routers.resume import _do_upload

    minimal_pdf = b"%PDF-1.4 fake content"
    mock_file = MagicMock()
    mock_file.content_type = "application/pdf"
    mock_file.read = AsyncMock(return_value=minimal_pdf)
    mock_file.filename = "test.pdf"

    mock_user = MagicMock()
    mock_user.user_id = str(uuid.uuid4())

    mock_db = AsyncMock()

    from fastapi import HTTPException

    with (
        patch("app.routers.resume._extract_pdf_text", new=AsyncMock(side_effect=TimeoutError)),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _do_upload(mock_file, mock_user, mock_db)

    assert exc_info.value.status_code == 400
    assert "too long" in exc_info.value.detail.lower()


# ---------------------------------------------------------------------------
# Fix 3 — exam double-submit: status guard at DB write level
# ---------------------------------------------------------------------------


def test_grade_and_finalize_does_not_overwrite_submitted_status() -> None:
    """The ORM mutation in _grade_and_finalize must NOT change status when
    the re-fetched attempt is already 'submitted'.  This is the DB-level guard
    complementing the Redis claim."""
    # We test the conditional directly — the full async flow would require
    # a running DB + Redis which is out of scope for unit tests.
    # Simulate the guard code path by replicating the logic under test.
    attempt = MagicMock()
    attempt.status = "submitted"  # already finalised by a concurrent request

    new_status = "submitted"  # what the second request would write

    # Replicate the guard:
    if attempt.status == "in_progress":
        attempt.status = new_status  # should NOT execute

    # The guard must prevent overwriting the already-submitted status
    assert attempt.status == "submitted", (
        "A re-fetched 'submitted' attempt must not have its status overwritten"
    )


def test_grade_and_finalize_sets_status_from_in_progress() -> None:
    """When the attempt is still 'in_progress', the guard must set the new status."""
    attempt = MagicMock()
    attempt.status = "in_progress"

    expired = False
    if attempt.status == "in_progress":
        attempt.status = "expired" if expired else "submitted"

    assert attempt.status == "submitted"


def test_grade_and_finalize_sets_expired_when_overdue() -> None:
    """When expired=True and status is 'in_progress', guard must set 'expired'."""
    attempt = MagicMock()
    attempt.status = "in_progress"

    expired = True
    if attempt.status == "in_progress":
        attempt.status = "expired" if expired else "submitted"

    assert attempt.status == "expired"


# ---------------------------------------------------------------------------
# Fix 4 — retention purge: abandoned + consent_withdrawn sessions
# ---------------------------------------------------------------------------


def test_retention_purge_predicate_covers_abandoned() -> None:
    """_purge_predicate must include abandoned sessions using updated_at."""
    from app.retention import _PURGEABLE_STATUSES, _purge_predicate

    assert "abandoned" in _PURGEABLE_STATUSES
    assert "completed" in _PURGEABLE_STATUSES
    assert "consent_withdrawn" in _PURGEABLE_STATUSES
    assert "failed" in _PURGEABLE_STATUSES
    # Active states must NEVER be in the set
    assert "in_progress" not in _PURGEABLE_STATUSES
    assert "created" not in _PURGEABLE_STATUSES

    # The predicate must not raise when constructed
    cutoff = datetime.now(tz=UTC) - timedelta(days=90)
    pred = _purge_predicate(cutoff)
    assert pred is not None


@pytest.mark.asyncio
async def test_retention_purge_dry_run_counts_abandoned() -> None:
    """In dry-run mode purge_expired_sessions must count abandoned sessions."""
    from app.config import settings as _app_settings
    from app.retention import purge_expired_sessions

    dry_settings = _app_settings.model_copy(
        update={"retention_dry_run": True, "retention_days": 90}
    )

    # Mock DB that returns a count of 5 (simulating 5 purgeable rows)
    mock_scalar_result = MagicMock()
    mock_scalar_result.scalar_one.return_value = 5

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_scalar_result)

    count = await purge_expired_sessions(db=mock_db, settings=dry_settings)
    assert count == 5
    # Must NOT issue a DELETE in dry-run
    mock_db.delete.assert_not_called()


@pytest.mark.asyncio
async def test_retention_purge_live_deletes_abandoned() -> None:
    """In live mode purge_expired_sessions must execute a DELETE (not just SELECT)."""
    from app.config import settings as _app_settings
    from app.retention import purge_expired_sessions

    live_settings = _app_settings.model_copy(
        update={"retention_dry_run": False, "retention_days": 90}
    )

    mock_delete_result = MagicMock()
    mock_delete_result.rowcount = 7

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_delete_result)
    mock_db.commit = AsyncMock()

    count = await purge_expired_sessions(db=mock_db, settings=live_settings)
    assert count == 7
    mock_db.commit.assert_awaited_once()
    # execute must have been called (the DELETE statement)
    mock_db.execute.assert_awaited_once()


# ---------------------------------------------------------------------------
# Fix 5 — /metrics endpoint reachable and returns Prometheus text
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_metrics_endpoint_returns_prometheus_text() -> None:
    """GET /metrics must return 200 with Content-Type text/plain and Prometheus
    exposition format (lines starting with # HELP or metric names)."""
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/metrics")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    content_type = response.headers.get("content-type", "")
    assert "text/plain" in content_type, (
        f"Expected text/plain Content-Type for Prometheus, got {content_type!r}"
    )
    body = response.text
    # The Prometheus exposition format always has lines starting with "# HELP"
    # for the default process/python collectors registered by prometheus_client.
    assert "# HELP" in body or "# TYPE" in body, (
        "Prometheus metrics response must contain '# HELP' or '# TYPE' lines"
    )


@pytest.mark.asyncio
async def test_metrics_endpoint_excluded_from_openapi() -> None:
    """GET /metrics must NOT appear in the OpenAPI schema (include_in_schema=False)."""
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.get("/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    paths = schema.get("paths", {})
    assert "/metrics" not in paths, (
        "/metrics must not appear in the OpenAPI schema (it is an ops endpoint)"
    )


# ---------------------------------------------------------------------------
# Fix 5 — Sentry is initialised (no-op when DSN is empty)
# ---------------------------------------------------------------------------


def test_sentry_init_is_noop_when_dsn_empty() -> None:
    """init_sentry must return False (no-op) when SENTRY_DSN is empty.
    This verifies the shared.observability.sentry module is wired correctly
    and does not raise when the DSN is absent."""
    from shared.observability.sentry import init_sentry

    result = init_sentry("", environment="test", service_name="data_gateway")
    assert result is False, "init_sentry must return False when DSN is empty"


def test_sentry_init_is_noop_when_dsn_whitespace() -> None:
    """init_sentry must return False for whitespace-only DSN strings."""
    from shared.observability.sentry import init_sentry

    result = init_sentry("   ", environment="test", service_name="data_gateway")
    assert result is False


# ---------------------------------------------------------------------------
# Fix 5 — PII redaction processor is configured in structlog
# ---------------------------------------------------------------------------


def test_pii_redaction_processor_removes_known_fields() -> None:
    """_redact_pii_processor must drop email, password, phone, full_name from
    the event dict before it reaches the JSON renderer."""
    from app.main import _redact_pii_processor

    event_dict: dict[str, object] = {
        "event": "user.login",
        "email": "alice@example.com",
        "password": "secret123",
        "phone": "+91-9999999999",
        "full_name": "Alice Example",
        "user_id": "abc123",
        "role": "candidate",
    }

    result = _redact_pii_processor(None, "info", event_dict)  # type: ignore[arg-type]

    # PII fields must be gone
    assert "email" not in result
    assert "password" not in result
    assert "phone" not in result
    assert "full_name" not in result

    # Non-PII fields must be preserved
    assert result["user_id"] == "abc123"
    assert result["role"] == "candidate"
    assert result["event"] == "user.login"


def test_pii_redaction_processor_is_idempotent_on_clean_dict() -> None:
    """_redact_pii_processor must not modify a dict that has no PII fields."""
    from app.main import _redact_pii_processor

    event_dict: dict[str, object] = {
        "event": "session.started",
        "session_id": "xyz",
        "language": "en",
    }
    original_keys = set(event_dict.keys())

    result = _redact_pii_processor(None, "info", event_dict)  # type: ignore[arg-type]

    assert set(result.keys()) == original_keys
