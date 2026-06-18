"""Async SQLAlchemy engine + session factory for data_gateway.

The engine and sessionmaker are initialised once at startup and torn down
at shutdown. Use get_db_session() as a FastAPI dependency.

Cloud / pgBouncer note:
  When DATABASE_SSL=require is set, the engine is created with:
    - connect_args={"ssl": "require", "statement_cache_size": 0}
    - poolclass=NullPool   (pgBouncer already pools server-side; SQLAlchemy
                            client-side pooling on top causes "prepared statement
                            does not exist" errors in transaction mode)
  Leave DATABASE_SSL blank for local Postgres (no SSL, QueuePool is fine).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.config import settings

# ---------------------------------------------------------------------------
# Module-level singletons — set in startup, cleared in shutdown
# ---------------------------------------------------------------------------
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_engine() -> None:
    """Create the async engine. Call once at application startup."""
    global _engine, _session_factory

    if settings.database_ssl:
        # Prisma / pgBouncer pooled endpoint: SSL required, prepared-statement
        # cache disabled (pgBouncer transaction mode rejects named statements),
        # NullPool so SQLAlchemy doesn't add a second pool on top of pgBouncer.
        _engine = create_async_engine(
            settings.database_url,
            connect_args={
                "ssl": settings.database_ssl,
                "statement_cache_size": 0,
            },
            poolclass=NullPool,
            pool_pre_ping=True,
            echo=False,
        )
    else:
        _engine = create_async_engine(
            settings.database_url,
            pool_size=settings.database_pool_size,
            pool_pre_ping=True,
            echo=False,
        )
    _session_factory = async_sessionmaker(
        _engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )


async def dispose_engine() -> None:
    """Dispose the async engine. Call at application shutdown."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the sessionmaker. Raises if not initialised."""
    if _session_factory is None:
        raise RuntimeError("Database engine not initialised. Call init_engine() first.")
    return _session_factory


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yield a single-request DB session."""
    factory = get_session_factory()
    async with factory() as session:
        yield session
