#!/usr/bin/env bash
# ===========================================================================
# One-shot setup for deploying the full backend on an Oracle Cloud VM
# (Ubuntu 22.04). Run from the repo root, as a sudo user:
#
#   sudo PUBLIC_WEB_ORIGIN=https://your-app.vercel.app ./scripts/oracle-setup.sh
#
# It will:
#   1. install Docker + compose plugin
#   2. open the host firewall for ports 8001-8004
#   3. write deploy.env
#   4. build + start all 5 backend containers
#   5. run the database migrations (once)
#
# Coding exams run via JDoodle (hosted API) — NO Piston, NO VM extras. Make sure
# services/data_gateway/.env has EXECUTION_PROVIDER=jdoodle + JDOODLE_CLIENT_ID +
# JDOODLE_CLIENT_SECRET (free creds at https://www.jdoodle.com/).
#
# NOTE: you ALSO must open ports 8001-8004 in the OCI Console
#       (Networking > VCN > Security List > Ingress) — that can't be done here.
# ===========================================================================
set -euo pipefail

# Re-run with sudo if not root.
if [ "$(id -u)" -ne 0 ]; then exec sudo -E "$0" "$@"; fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PUBLIC_WEB_ORIGIN="${PUBLIC_WEB_ORIGIN:-}"

echo "==> Repo: $REPO_ROOT   Arch: $(uname -m)"

# --- 1. Docker -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker ..."
  curl -fsSL https://get.docker.com | sh
fi
echo "==> Installing iptables-persistent ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y iptables-persistent

# --- 2. Host firewall (Oracle Ubuntu blocks everything but SSH by default) --
# ONLY Caddy (the TLS reverse proxy) is public: ports 80 + 443. The four app
# services (8001-8004) are INTERNAL to the Docker network and must NEVER be
# opened to the internet — doing so serves candidate PII + JWTs in CLEARTEXT,
# bypassing TLS and Caddy. (Older versions of this script opened 8001-8004; that
# was a security bug — do not reinstate it.)
echo "==> Opening host firewall for 80 + 443 (Caddy TLS proxy only) ..."
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT -p tcp --dport "$p" -j ACCEPT
done
netfilter-persistent save || true
echo "    (Also open ONLY 80 + 443 in the OCI Console Security List — NOT 8001-8004.)"

# --- 3. deploy.env ---------------------------------------------------------
if [ ! -f deploy.env ]; then
  if [ -z "$PUBLIC_WEB_ORIGIN" ]; then
    echo "ERROR: PUBLIC_WEB_ORIGIN is not set and deploy.env does not exist."
    echo "Re-run:  sudo PUBLIC_WEB_ORIGIN=https://your-app.vercel.app $0"
    exit 1
  fi
  echo "PUBLIC_WEB_ORIGIN=${PUBLIC_WEB_ORIGIN}" > deploy.env
  echo "==> Wrote deploy.env"
fi
echo "==> Using deploy.env:"; sed 's/^/    /' deploy.env

COMPOSE="docker compose --env-file deploy.env -f docker-compose.prod.yml"

# --- 4. Build + start ------------------------------------------------------
echo "==> Building images (first build takes several minutes) ..."
$COMPOSE build
echo "==> Starting all containers ..."
$COMPOSE up -d

# --- 5. Migrations (wait for data_gateway, then upgrade once) ---------------
echo "==> Waiting for data_gateway to answer on :8002 ..."
for i in $(seq 1 40); do
  if curl -fsS http://localhost:8002/health/live >/dev/null 2>&1; then break; fi
  sleep 3
  [ "$i" = 40 ] && { echo "data_gateway did not come up — check: $COMPOSE logs data_gateway"; exit 1; }
done
echo "==> Running database migrations ..."
$COMPOSE exec -T data_gateway alembic -c alembic.ini upgrade head

# --- Done ------------------------------------------------------------------
PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || echo '<this-vm-ip>')"
cat <<EOF

============================================================
 DONE. The 5 backend services are running.

 Health checks (should say {"status":"alive"}):
   curl http://localhost:8001/health/live   # interview-core
   curl http://localhost:8002/health/live   # data-gateway
   curl http://localhost:8003/health/live   # feedback-billing
   curl http://localhost:8004/health/live   # admin-ops

 NEXT:
 1. OCI Console > VCN > Security List > add Ingress for TCP 8001-8004.
 2. In web/vercel.json point the 4 rewrites at this VM:
      http://${PUBLIC_IP}:8002  (gateway)   http://${PUBLIC_IP}:8001 (interview)
      http://${PUBLIC_IP}:8003  (feedback)  http://${PUBLIC_IP}:8004 (admin)
    then redeploy the Vercel frontend.
 3. Make yourself admin:
      $COMPOSE exec -T admin_ops python scripts/grant_admin.py YOUR_EMAIL

 Coding exams use JDoodle — confirm services/data_gateway/.env has
 EXECUTION_PROVIDER=jdoodle + JDOODLE_CLIENT_ID + JDOODLE_CLIENT_SECRET.

 Manage:  $COMPOSE ps | logs -f <svc> | down
============================================================
EOF
