"""admin_ops — FastAPI application entry point (S5-002)."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin_auth import verify_admin_role
from app.config import settings
from app.database import dispose_engine, init_engine
from app.health import router as health_router
from app.redis_client import close_redis, init_redis

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(logging, settings.log_level.upper(), logging.INFO)
    ),
)

log = structlog.get_logger(__name__)

# All routes under /admin automatically require admin role.
from fastapi import APIRouter  # noqa: E402

from app.routers.analytics import router as analytics_router  # noqa: E402
from app.routers.erasure import router as erasure_router  # noqa: E402

admin_router = APIRouter(prefix="/admin", dependencies=[Depends(verify_admin_role)])


@admin_router.get("/status")
async def admin_status() -> dict[str, str]:
    """Admin liveness probe — confirms the admin guard is active."""
    return {"status": "ok", "service": settings.service_name}


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    init_engine()
    init_redis()
    log.info("service.start", service=settings.service_name, env=settings.app_env)
    yield
    await dispose_engine()
    await close_redis()
    log.info("service.stop", service=settings.service_name)


app = FastAPI(
    title="Intants Admin & Ops",
    description="Admin dashboard APIs, analytics, DPDP erasure",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health_router)
app.include_router(admin_router)
app.include_router(erasure_router)
app.include_router(analytics_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": settings.service_name, "env": settings.app_env, "version": "0.1.0"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
