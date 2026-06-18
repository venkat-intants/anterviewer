# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# interview_core — LiveKit API + LiveKit worker (one image, two run modes).
#
# BUILD CONTEXT: repo root (Railway sets "root": "/" in railway.json).
#
# RUN MODES (same image, different CMD):
#   API:    uvicorn app.main:app --host 0.0.0.0 --port $PORT   (default CMD)
#   Worker: python -m app.worker.interview_worker start         (override CMD)
#
# CRITICAL: livekit-agents + livekit-plugins-* are NOT in pyproject.toml.
# They were pip-installed directly into the dev .venv. The requirements.txt
# (generated via `pip freeze` from that .venv) captures them exactly:
#   livekit-agents==1.5.15
#   livekit-plugins-openai==1.5.15
#   livekit-plugins-sarvam==1.5.15
#   livekit-plugins-silero==1.5.15
#   livekit-plugins-simli==1.5.15
#   livekit-plugins-tavus==1.5.15
# ---------------------------------------------------------------------------

# ---- Stage 1: build native extensions ----
FROM python:3.12-slim AS builder

WORKDIR /build

# gcc/g++: asyncpg, cryptography, av (PyAV for audio), cffi
# portaudio: sounddevice (LiveKit VAD path)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        libffi-dev \
        libpq-dev \
        portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

COPY services/interview_core/requirements.txt ./

RUN pip install --upgrade pip --no-cache-dir \
    && pip install --prefix=/install --no-cache-dir -r requirements.txt

# ---- Stage 2: lean runtime image ----
FROM python:3.12-slim AS runtime

RUN useradd --create-home --no-log-init --uid 1001 appuser

WORKDIR /app

# libportaudio2: sounddevice (silero VAD audio I/O — links to portaudio at runtime)
# libgomp1:      fallback OpenMP for onnxruntime (silero VAD); wheel bundles it
#                but the system lib is a cheap safety net
# libpq5:        asyncpg native driver
# PyAV (av==17) and onnxruntime ship bundled native libs in their wheels;
# no additional system libav or libonnxruntime needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libffi8 \
        libpq5 \
        libportaudio2 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

# shared/ from repo root
COPY --chown=appuser:appuser shared /app/shared

# Service code
COPY --chown=appuser:appuser services/interview_core /app

# shared/ at /app/shared/. PYTHONPATH=/app resolves `from shared.xxx import ...`.
# No editable install — poetry-core build backend is not needed at runtime.

USER appuser

ENV PORT=8001 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PYTHONUTF8=1

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health/live')"

# Default = API.
# Railway worker service overrides this to:
#   python -m app.worker.interview_worker start
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
