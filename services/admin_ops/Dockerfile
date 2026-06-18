# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# admin_ops — Admin dashboard APIs, analytics, ops endpoints.
#
# BUILD CONTEXT: repo root (Railway sets "root": "/" in railway.json).
# Multi-stage build. Non-root user (uid 1001). Binds to $PORT or 8004.
# ---------------------------------------------------------------------------

# ---- Stage 1: build native extensions ----
FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libffi-dev \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY services/admin_ops/requirements.txt ./

RUN pip install --upgrade pip --no-cache-dir \
    && pip install --prefix=/install --no-cache-dir -r requirements.txt

# ---- Stage 2: lean runtime image ----
FROM python:3.12-slim AS runtime

RUN useradd --create-home --no-log-init --uid 1001 appuser

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libffi8 \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

# shared/ from repo root
COPY --chown=appuser:appuser shared /app/shared

# Service code
COPY --chown=appuser:appuser services/admin_ops /app

# shared/ at /app/shared/. PYTHONPATH=/app resolves `from shared.xxx import ...`.
# No editable install — poetry-core build backend is not needed at runtime.

USER appuser

ENV PORT=8004 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

EXPOSE 8004

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8004/health/live')"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
