# CI Workflow — Intants AI Voice Interview Platform

Task: S4-006 / Sprint 3 retro A1 / issue #36  
File: `.github/workflows/ci.yml`

---

## What each job does

### `backend` (matrix: data_gateway, interview_core)

Runs in parallel for both services against shared Postgres 16 + Redis 7
service containers. Steps per service:

1. Set up Python 3.12 + Poetry (venv cached per-service per-pyproject hash)
2. `poetry install --no-interaction`
3. `alembic upgrade head` — data_gateway owns the schema; interview_core matrix
   entry also migrates from the data_gateway directory so its schema exists
4. `ruff check` — lint
5. `mypy app --no-error-summary` — type-check (see known issues below)
6. `pytest tests/ -q -m "not integration"` — unit tests + in-process integration
   tests; live external-API tests (`@pytest.mark.integration`) are excluded

The `shared/` package is installed as an editable path dependency via Poetry so
it is already on PYTHONPATH for both services — no extra `PYTHONPATH` export is
needed.

Coverage is NOT instrumented yet — `pytest-cov` is not in `pyproject.toml`.
Sprint 5 will add `pytest-cov` and `@vitest/coverage-v8`, then set thresholds.

### `frontend`

Single job (no matrix). Node 22, npm cached on `web/package-lock.json` hash.

1. `npm ci` — clean lockfile install
2. `npm run lint` — eslint (max-warnings 0, will fail on any warning)
3. `npm run build` — runs `tsc -b && vite build`; catches type errors at
   build time
4. `npm test -- --run` — Vitest in run mode (not watch mode); jsdom only,
   no network calls

### `e2e` (opt-in — see cost guard below)

Depends on `[backend, frontend]` — both must be green before E2E starts.

1. Starts `infra/docker/docker-compose.yml` services: Postgres, Redis, MinIO,
   Mailpit (the `--wait` flag blocks until healthchecks pass)
2. Runs `alembic upgrade head` against the compose Postgres
3. Starts `data_gateway` on `:8002` and `interview_core` on `:8001` as
   background processes
4. Starts the Vite dev server on `:5173`
5. Waits for all three HTTP health checks to pass (60 s timeout per service)
6. Installs Playwright Chromium (cached)
7. Runs `npm run e2e` (Playwright test suite in `web/e2e/`)
8. On failure: uploads Playwright traces + screenshots as a workflow artifact
   (7-day retention)
9. Always: dumps stdout logs from all three background services

Wall-time targets: backend + frontend combined under 8 minutes; E2E under
4 minutes (Playwright spec ~42 s + Docker boot ~60 s + service warmup ~60 s).

---

## Required GitHub secrets

Add these under **Settings → Secrets and variables → Actions → Repository secrets**
before running the first PR.

| Secret name | Used by | Description |
|---|---|---|
| `SARVAM_API_KEY` | backend (interview_core), e2e | Sarvam AI STT + TTS API key. Sign up at https://dashboard.sarvam.ai/ |
| `GEMINI_API_KEY` | e2e only | Google AI Studio key. Required only when the `e2e` label is applied. Backend unit tests use a placeholder (empty string) which causes live-Gemini tests to self-skip. Sign up at https://aistudio.google.com/ |
| `SIMLI_API_KEY` | backend (interview_core), e2e | Simli AI interactive avatar key. Sign up at https://app.simli.com/ |
| `SIMLI_FACE_ID` | e2e (Vite VITE_SIMLI_FACE_ID) | The face ID from the Simli library to use for the E2E session. Pick from the Simli dashboard. |
| `ANTHROPIC_API_KEY` | backend (optional), e2e | Required only if `LLM_PROVIDER=anthropic`. Currently `LLM_PROVIDER=gemini` in CI so this is a no-op for backend tests; included for completeness. |

Secrets that are NOT required for backend + frontend jobs to pass:

- `GEMINI_API_KEY` — backend tests skip live-Gemini tests automatically when
  the key is empty. No secret needed until E2E is triggered.
- Any Bhashini / OpenAI / ElevenLabs / HeyGen / AWS Bedrock credentials — not
  used in CI at all.

### How to add a secret

1. GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name = secret name from table above, Value = actual API key
4. Click "Add secret"

Do this once per environment. Secrets are available to all branches immediately
(no re-push required).

---

## How to trigger the E2E job

The E2E job is **opt-in** to control API costs.

### Option A — PR label (recommended for code review)

1. Open a pull request (or go to an existing one)
2. In the right sidebar → Labels → click the gear → type `e2e` → select it
3. Adding the label re-runs the workflow automatically IF the workflow has
   already run (use "Re-run all jobs" on the Actions tab if not)
4. Remove the label after the E2E run passes to prevent future pushes to the
   same branch from triggering it again

The label must be created in the repo first:  
Settings → Labels → New label → name `e2e`, colour `#e11d48` (red, to signal cost)

### Option B — Manual trigger (for on-demand runs)

1. GitHub repo → Actions → CI workflow
2. Click "Run workflow" (top right of the run list)
3. Select branch → click "Run workflow"

This always runs backend + frontend + e2e regardless of labels.

---

## Cost expectations

| Job | External API calls | Estimated cost per run |
|---|---|---|
| `backend` | None (mocked / skipped) | ~₹0 |
| `frontend` | None | ~₹0 |
| `e2e` (opt-in) | Gemini (LLM), Sarvam (STT + TTS) | ~₹1–2 |

The E2E estimate assumes one complete 10-minute interview session (the Playwright
spec drives a single session end-to-end). Gemini 2.5 Flash costs roughly $0.15
per session at 10k tokens; Sarvam STT + TTS adds a small surcharge.

Keep the `e2e` label off routine PRs (style, docs, config changes). Apply it
only to PRs that touch the voice pipeline, WebSocket protocol, auth flows, or
the interview LangGraph.

---

## Known issues

### mypy "Source file found twice" (task #13)

When mypy resolves the `shared/` editable path install alongside the service's
own `app/` package, it occasionally discovers the same module file through two
different sys.path entries and raises:

```
error: Source file found twice under different module names: ...
```

This produces **exit code 2** (mypy's code for "errors found") rather than exit
code 1 (usage/config error). The CI workflow catches this specifically:

- Exit code 0 → clean pass
- Exit code 2 → printed as a `::warning::` annotation in the Actions log, job
  continues (non-fatal)
- Any other non-zero exit code → job fails

This workaround is temporary. Task #13 will fix the root cause (likely a mypy
`exclude` pattern or a `namespace_packages = false` setting in `pyproject.toml`).
Once task #13 is merged, remove the `set +e / MYPY_EXIT / set -e` block from
the workflow and replace it with a plain `poetry run mypy app`.

---

## Local equivalent commands

These are the exact commands the CI workflow runs, so you can reproduce a CI
failure locally:

```bash
# Backend — data_gateway
cd services/data_gateway
poetry install --no-interaction
poetry run alembic upgrade head
poetry run ruff check .
poetry run mypy app --no-error-summary
poetry run pytest tests/ -q -m "not integration"

# Backend — interview_core (alembic must be run from data_gateway first)
cd services/interview_core
poetry install --no-interaction
poetry run ruff check .
poetry run mypy app --no-error-summary
poetry run pytest tests/ -q -m "not integration"

# Frontend
cd web
npm ci
npm run lint
npm run build
npm test -- --run

# E2E (full stack)
docker compose -f infra/docker/docker-compose.yml up -d
cd services/data_gateway && poetry run alembic upgrade head
# start data_gateway on :8002, interview_core on :8001, vite on :5173
cd web
npx playwright install --with-deps chromium
npm run e2e
```
