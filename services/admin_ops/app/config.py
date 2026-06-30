from __future__ import annotations

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from shared.security import assert_strong_secrets


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    service_name: str = "admin_ops"
    app_env: str = "development"
    log_level: str = "INFO"
    host: str = "0.0.0.0"
    port: int = 8004

    database_url: str  # required — no default; service fails fast if unset
    database_pool_size: int = 5
    # When non-empty, asyncpg passes ssl="require" + statement_cache_size=0
    # (required for pgBouncer/Prisma pooled endpoints). Set DATABASE_SSL=require
    # in any cloud env. Leave blank for local Postgres (no SSL, no pgBouncer).
    database_ssl: str = ""

    redis_url: str  # required — no default; service fails fast if unset

    jwt_secret: str  # required — no default; service fails fast if unset
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "intants-data-gateway"
    jwt_audience: str = "intants-services"

    sentry_dsn: str = ""
    cors_allowed_origins: str = "http://localhost:5173"

    # Peer microservice base URLs — used by the /admin/system/health aggregator.
    # Defaults to localhost dev ports; override in cloud via env. All optional so a
    # stale .env never crashes startup.
    interview_core_url: str = "http://localhost:8001"
    data_gateway_url: str = "http://localhost:8002"
    feedback_billing_url: str = "http://localhost:8003"

    @model_validator(mode="after")
    def validate_secret_strength(self) -> "Settings":
        """Fail fast in production/staging if JWT_SECRET is a weak placeholder
        (must match data_gateway's). No-op in development/test."""
        assert_strong_secrets(self.app_env, {"JWT_SECRET": self.jwt_secret})
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


settings = Settings()
