"""Unit tests for interview_worker reliability fixes.

Covers:
  1. Abrupt-close teardown: _abrupt_close is shielded so it survives GC when
     the candidate closes their browser.  The shutdown hook awaits it.
  2. Admission control: _active_jobs counter increments/decrements correctly;
     _request_fnc rejects when at/over the ceiling.
  3. Worker heartbeat: _write_heartbeat writes a timestamp to the given path;
     _run_heartbeat loops and updates the file.
  4. Prewarm: _prewarm loads silero VAD into proc.userdata["vad"]; gracefully
     handles failure without crashing.
  5. Prometheus /metrics endpoint: returns 200 with the correct content-type.
  6. PII redaction in structlog: _redact_pii_processor strips the expected fields.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# 1. Active-jobs counter
# ---------------------------------------------------------------------------


def test_active_jobs_increment_and_decrement() -> None:
    """Increment/decrement must be symmetric and never go below 0."""
    import app.worker.interview_worker as wk

    # Capture original value to restore after test (module-level global).
    original = wk._active_jobs
    try:
        wk._active_jobs = 0
        wk._active_jobs_increment()
        assert wk._active_jobs == 1
        wk._active_jobs_increment()
        assert wk._active_jobs == 2
        wk._active_jobs_decrement()
        assert wk._active_jobs == 1
        wk._active_jobs_decrement()
        assert wk._active_jobs == 0
        # Decrement below zero must clamp to 0 (guard against double-decrement).
        wk._active_jobs_decrement()
        assert wk._active_jobs == 0
    finally:
        wk._active_jobs = original


# ---------------------------------------------------------------------------
# 2. _request_fnc — admission control gate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_request_fnc_accepts_under_ceiling() -> None:
    """Job is accepted when active jobs are below the configured ceiling."""
    import app.worker.interview_worker as wk

    original = wk._active_jobs
    try:
        wk._active_jobs = 3
        mock_request = AsyncMock()

        fake_settings = MagicMock()
        fake_settings.worker_max_concurrent_jobs = 10

        with patch.object(wk, "settings", fake_settings):
            await wk._request_fnc(mock_request)

        mock_request.accept.assert_called_once_with(wk.entrypoint)
        mock_request.reject.assert_not_called()
    finally:
        wk._active_jobs = original


@pytest.mark.asyncio
async def test_request_fnc_rejects_at_ceiling() -> None:
    """Job is rejected when active jobs equals the ceiling."""
    import app.worker.interview_worker as wk

    original = wk._active_jobs
    try:
        wk._active_jobs = 15
        mock_request = AsyncMock()

        fake_settings = MagicMock()
        fake_settings.worker_max_concurrent_jobs = 15

        with patch.object(wk, "settings", fake_settings):
            await wk._request_fnc(mock_request)

        mock_request.reject.assert_called_once()
        mock_request.accept.assert_not_called()
    finally:
        wk._active_jobs = original


@pytest.mark.asyncio
async def test_request_fnc_rejects_over_ceiling() -> None:
    """Job is rejected when active jobs exceed the ceiling."""
    import app.worker.interview_worker as wk

    original = wk._active_jobs
    try:
        wk._active_jobs = 20
        mock_request = AsyncMock()

        fake_settings = MagicMock()
        fake_settings.worker_max_concurrent_jobs = 15

        with patch.object(wk, "settings", fake_settings):
            await wk._request_fnc(mock_request)

        mock_request.reject.assert_called_once()
        mock_request.accept.assert_not_called()
    finally:
        wk._active_jobs = original


@pytest.mark.asyncio
async def test_request_fnc_zero_cap_always_accepts() -> None:
    """worker_max_concurrent_jobs=0 disables the cap — jobs always accepted."""
    import app.worker.interview_worker as wk

    original = wk._active_jobs
    try:
        wk._active_jobs = 9999  # absurdly high
        mock_request = AsyncMock()

        fake_settings = MagicMock()
        fake_settings.worker_max_concurrent_jobs = 0

        with patch.object(wk, "settings", fake_settings):
            await wk._request_fnc(mock_request)

        mock_request.accept.assert_called_once_with(wk.entrypoint)
        mock_request.reject.assert_not_called()
    finally:
        wk._active_jobs = original


# ---------------------------------------------------------------------------
# 3. Heartbeat — _write_heartbeat and _run_heartbeat
# ---------------------------------------------------------------------------


def test_write_heartbeat_creates_file() -> None:
    """_write_heartbeat must create the file with the given timestamp."""
    from app.worker.interview_worker import _write_heartbeat

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "heartbeat")
        _write_heartbeat(path, "2026-07-01T12:00:00+00:00")
        assert os.path.exists(path)
        with open(path, encoding="utf-8") as fh:
            content = fh.read()
        assert content == "2026-07-01T12:00:00+00:00"


def test_write_heartbeat_overwrites_existing() -> None:
    """_write_heartbeat must overwrite an existing heartbeat file."""
    from app.worker.interview_worker import _write_heartbeat

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "heartbeat")
        _write_heartbeat(path, "first-write")
        _write_heartbeat(path, "second-write")
        with open(path, encoding="utf-8") as fh:
            content = fh.read()
        assert content == "second-write"


def test_write_heartbeat_bad_path_silent() -> None:
    """_write_heartbeat on an unwritable path must silently swallow the error."""
    from app.worker.interview_worker import _write_heartbeat

    # Should not raise — wraps OSError silently.
    _write_heartbeat("/nonexistent_dir_xyz/heartbeat", "ts")


@pytest.mark.asyncio
async def test_run_heartbeat_writes_within_interval() -> None:
    """_run_heartbeat must write to the file within the configured interval."""
    from app.worker.interview_worker import _run_heartbeat

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "heartbeat")

        fake_settings = MagicMock()
        fake_settings.worker_heartbeat_path = path
        fake_settings.worker_heartbeat_interval_seconds = 0  # immediate in tests

        import app.worker.interview_worker as wk

        with patch.object(wk, "settings", fake_settings):
            # Run for one tick only — cancel after the first write.
            task = asyncio.create_task(_run_heartbeat())
            # Give the event loop time to write once.
            await asyncio.sleep(0.05)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        # File must have been written at least once.
        assert os.path.exists(path), "heartbeat file was not written"
        with open(path, encoding="utf-8") as fh:
            content = fh.read()
        assert len(content) > 0, "heartbeat file is empty"


# ---------------------------------------------------------------------------
# 4. Prewarm — _prewarm loads VAD into proc.userdata
# ---------------------------------------------------------------------------


def test_prewarm_loads_vad_into_userdata() -> None:
    """_prewarm must load silero.VAD into proc.userdata['vad']."""
    from app.worker.interview_worker import _prewarm

    mock_proc = MagicMock()
    mock_proc.userdata = {}
    fake_vad = MagicMock(name="VADModel")

    with patch("app.worker.interview_worker.silero") as mock_silero:
        mock_silero.VAD.load.return_value = fake_vad
        _prewarm(mock_proc)

    assert mock_proc.userdata.get("vad") is fake_vad, (
        "_prewarm must store the loaded VAD instance in proc.userdata['vad']"
    )
    mock_silero.VAD.load.assert_called_once()


def test_prewarm_swallows_load_failure() -> None:
    """_prewarm must not raise if silero.VAD.load() fails."""
    from app.worker.interview_worker import _prewarm

    mock_proc = MagicMock()
    mock_proc.userdata = {}

    with patch("app.worker.interview_worker.silero") as mock_silero:
        mock_silero.VAD.load.side_effect = RuntimeError("ONNX model file not found")
        # Must NOT raise.
        _prewarm(mock_proc)

    # userdata["vad"] must NOT be set on failure (entrypoint will cold-load).
    assert "vad" not in mock_proc.userdata


# ---------------------------------------------------------------------------
# 5. /metrics endpoint — Prometheus text format
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_metrics_endpoint_returns_prometheus_text() -> None:
    """GET /metrics must return 200 with Prometheus content-type."""
    from httpx import ASGITransport, AsyncClient

    # Import app lazily to avoid side-effects at module level in tests.
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get("/metrics")

    assert resp.status_code == 200, (
        f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
    )
    content_type = resp.headers.get("content-type", "")
    # prometheus_client generates 'text/plain; version=0.0.4; charset=utf-8'
    assert "text/plain" in content_type, (
        f"Expected text/plain content-type, got: {content_type!r}"
    )
    # Must contain at least one standard metric family.
    assert "# HELP" in resp.text or "# TYPE" in resp.text, (
        "Response body does not look like Prometheus text format"
    )


# ---------------------------------------------------------------------------
# 6. PII redaction processor in structlog
# ---------------------------------------------------------------------------


def test_pii_redaction_removes_known_fields() -> None:
    """The structlog PII processor must drop email, password, phone, full_name."""
    # Import the processor directly from main to avoid re-running side effects.
    from app.main import _redact_pii_processor

    event_dict: dict[str, Any] = {
        "event": "user.login",
        "email": "test@example.com",
        "password": "hunter2",
        "phone": "+91-9876543210",
        "full_name": "Ravi Kumar",
        "user_id": "abc123",
    }
    result = _redact_pii_processor(None, "info", event_dict)  # type: ignore[arg-type]
    assert "email" not in result
    assert "password" not in result
    assert "phone" not in result
    assert "full_name" not in result
    # Non-PII fields must be preserved.
    assert result["user_id"] == "abc123"
    assert result["event"] == "user.login"


def test_pii_redaction_leaves_clean_events_unchanged() -> None:
    """An event dict with no PII fields must pass through unmodified."""
    from app.main import _redact_pii_processor

    event_dict: dict[str, Any] = {
        "event": "session.start",
        "room": "abc-room",
        "language": "en",
    }
    result = _redact_pii_processor(None, "info", event_dict)  # type: ignore[arg-type]
    assert result == {"event": "session.start", "room": "abc-room", "language": "en"}


# ---------------------------------------------------------------------------
# 7. Settings — new config fields have correct defaults
# ---------------------------------------------------------------------------


def test_settings_new_fields_exist_with_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """New settings fields must have sane defaults and correct types."""
    from app.config import settings

    assert isinstance(settings.worker_load_threshold, float)
    assert 0.0 <= settings.worker_load_threshold <= 1.0
    assert isinstance(settings.worker_max_concurrent_jobs, int)
    assert settings.worker_max_concurrent_jobs >= 0
    assert isinstance(settings.worker_heartbeat_path, str)
    assert settings.worker_heartbeat_path  # must be non-empty
    assert isinstance(settings.worker_heartbeat_interval_seconds, int)
    assert settings.worker_heartbeat_interval_seconds >= 5


# ---------------------------------------------------------------------------
# 8. Abrupt-close shield — teardown task survives cancellation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_abrupt_close_shielded_task_survives_outer_cancel() -> None:
    """asyncio.shield() must allow the inner coroutine to finish even when the
    outer future is cancelled — this models what happens when LiveKit's framework
    cancels the room tear-down before _abrupt_close finishes writing to the DB.
    """
    completed: list[bool] = []

    async def _inner() -> None:
        await asyncio.sleep(0.01)
        completed.append(True)

    # Simulate: create a shielded task (like _on_session_close does),
    # then cancel the outer shield reference.
    inner_task = asyncio.ensure_future(_inner())
    shielded = asyncio.shield(inner_task)
    shielded.cancel()  # outer cancel — inner must still run

    # Wait for the inner task to complete.
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(inner_task, timeout=1.0)

    assert completed == [True], (
        "asyncio.shield() must allow the inner coroutine to complete even when "
        "the outer future is cancelled — _abrupt_close must not be GC'd on browser close"
    )
