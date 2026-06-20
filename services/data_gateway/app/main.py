"""data_gateway — FastAPI application entry point.

Service lifecycle (managed by the ``lifespan`` async context manager):

  Startup:
    1. init_engine()        — create the async SQLAlchemy engine + session factory.
    2. init_redis()         — connect to Redis.
    3. get_auth_provider()  — instantiate the pluggable auth backend.
    4. AsyncIOScheduler     — start the daily DPDP §8(7) retention cron.
                              Runs at settings.retention_cron_hour UTC (default 03:00
                              UTC ≈ 08:30 IST).  Defaults to dry-run mode; set
                              RETENTION_DRY_RUN=false in production after confirming
                              expected delete counts via at least one dry-run cycle.

  Shutdown:
    1. scheduler.shutdown() — stop the retention cron (no-wait).
    2. dispose_engine()     — close the DB connection pool.
    3. close_redis()        — close the Redis connection.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, MutableMapping
from contextlib import asynccontextmanager
from typing import Any

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from shared.auth.factory import get_auth_provider

from app.config import settings
from app.database import dispose_engine, get_db_session, get_session_factory, init_engine
from app.dependencies import set_auth_provider
from app.health import router as health_router
from app.redis_client import close_redis, get_redis, init_redis
from app.retention import purge_expired_sessions
from app.routers.admin_hr import router as admin_hr_router
from app.routers.auth import router as auth_router
from app.routers.consent import router as consent_router
from app.routers.jd import router as jd_router
from app.routers.jobs import router as jobs_router
from app.routers.resume import router as resume_router
from app.routers.sso_google import router as sso_google_router
from app.routers.sso_naipunyam import router as sso_naipunyam_router

# ---------------------------------------------------------------------------
# PII redaction processor (defense-in-depth — DPDP §8)
#
# Drops known PII field names from every log event dict before rendering.
# This catches cases where a developer accidentally logs a raw field.
# Placed just before JSONRenderer in the processor chain.
# ---------------------------------------------------------------------------
_PII_FIELDS = frozenset({"email", "password", "phone", "full_name"})


def _redact_pii_processor(
    logger: Any, method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Remove PII fields from structlog event dict before rendering."""
    for field in _PII_FIELDS:
        event_dict.pop(field, None)
    return event_dict


structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        _redact_pii_processor,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(logging, settings.log_level.upper(), logging.INFO)
    ),
)

log = structlog.get_logger(__name__)


async def _run_retention_job() -> None:
    """APScheduler job wrapper: opens a fresh DB session, runs the purge, closes it.

    Errors are caught here to prevent the scheduler from dropping the job after
    one failure — a transient DB hiccup should not silence future nightly purges.
    """
    factory = get_session_factory()
    try:
        async with factory() as session:
            await purge_expired_sessions(db=session, settings=settings)
    except Exception as exc:  # broad — transient DB errors must not kill the scheduler
        log.error(
            "retention.purge.error",
            exc_type=type(exc).__name__,
            exc_msg=str(exc),
        )


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    # --- startup ---
    init_engine()
    init_redis()
    provider = get_auth_provider(
        settings=settings,
        db_session_factory=get_db_session,
        redis_client=get_redis(),
    )
    set_auth_provider(provider)

    # --- retention scheduler (DPDP §8(7)) ---
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _run_retention_job,
        CronTrigger(hour=settings.retention_cron_hour, minute=0, timezone="UTC"),
        id="retention_purge",
        name="DPDP §8(7) 90-day session purge",
        replace_existing=True,
    )
    scheduler.start()
    application.state.retention_scheduler = scheduler

    # Determine next-run time for the startup log (may be None if no jobs yet).
    next_run_job = scheduler.get_job("retention_purge")
    next_run_iso = (
        next_run_job.next_run_time.isoformat()
        if next_run_job and next_run_job.next_run_time
        else "unknown"
    )

    log.info(
        "service.start",
        service=settings.service_name,
        env=settings.app_env,
        auth_provider=settings.auth_provider,
        port=settings.port,
    )
    log.info(
        "retention.scheduler.started",
        retention_days=settings.retention_days,
        dry_run=settings.retention_dry_run,
        cron_hour_utc=settings.retention_cron_hour,
        next_run_iso=next_run_iso,
    )

    yield  # application runs here

    # --- shutdown ---
    scheduler.shutdown(wait=False)
    await dispose_engine()
    await close_redis()
    log.info("service.stop", service=settings.service_name)


app = FastAPI(
    title="Intants Data Gateway",
    description="Auth (pluggable), user management, Naipunyam SSO bridge",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    # "Cookie" is a forbidden CORS header name (browsers always send it, never
    # include it in preflight allow-lists — doing so is spec-invalid and ignored).
    # X-CSRF-Token is a custom request header set by JS for the double-submit
    # CSRF pattern on /auth/refresh — it MUST appear here so the preflight passes.
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(admin_hr_router)
app.include_router(consent_router)
app.include_router(jobs_router)
app.include_router(resume_router)
app.include_router(jd_router)
app.include_router(sso_naipunyam_router)
app.include_router(sso_google_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": settings.service_name,
        "env": settings.app_env,
        "version": "0.1.0",
    }
