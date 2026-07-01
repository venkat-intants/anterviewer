# Deploy on Oracle Cloud (Full Backend) — Simple Guide

This puts the **whole backend** (5 Docker containers) on **one free Oracle Cloud
VM**. The **website** goes on **Vercel** (separate, free). The database stays on
**Neon**. Coding exams run via **JDoodle** (a hosted API — no extra container).
Coding exams, MCQ exams, and interviews all work.

You will use 2 files that are already in this repo:
- `docker-compose.prod.yml` — defines the 5 containers
- `scripts/oracle-setup.sh` — sets everything up with one command

---

## Before you start

- An **Oracle Cloud** account (free): https://www.oracle.com/cloud/free/
- Your code on **GitHub** (the VM will download it).
- Your `services/*/.env` files ready (they hold your keys — they are NOT on GitHub).
- Your **Vercel** website link, e.g. `https://your-app.vercel.app`.
- **JDoodle credentials** (free, for coding exams): `services/data_gateway/.env` must have
  `EXECUTION_PROVIDER=jdoodle`, `JDOODLE_CLIENT_ID=...`, `JDOODLE_CLIENT_SECRET=...`
  (get them free at https://www.jdoodle.com/).

> **Good news — no ARM headaches.** Because coding exams use JDoodle (a hosted
> API call), there is **no Piston and no privileged container** to run. The 5
> backend services are plain Python and run perfectly on Oracle's free **ARM** VM
> with no special setup.

---

## Step 1 — Make the VM

1. Log in to Oracle Cloud → menu → **Compute** → **Instances** → **Create instance**.
2. **Image and shape:**
   - Image: **Ubuntu 22.04**
   - Shape: **Ampere (Arm)** → `VM.Standard.A1.Flex` → set **4 OCPU** and **24 GB RAM**
     (all free). If it says "out of capacity", try another Availability Domain or
     region, or come back later — this is common with the free ARM tier.
3. **SSH keys:** choose **Save private key** (download it — you need it to log in).
4. Click **Create**. When it's running, copy its **Public IP address**.

## Step 2 — Open the ports (do this in the Oracle website)

Open **only 80 and 443** — the Caddy TLS reverse proxy is the single public
entrypoint. **Do NOT open 8001–8004**: those are the internal service ports and
exposing them serves candidate PII + JWTs in **cleartext**, bypassing TLS.

1. Open your instance → click its **Virtual Cloud Network (VCN)** → **Security Lists**
   → **Default Security List**.
2. **Add Ingress Rules** → one rule each for **80** and **443**:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: **TCP**
   - Destination Port Range: `80` (then a second rule for `443`)
3. Save.

(The setup script opens the same two ports *inside* the VM. You need **both**.)
Caddy needs a domain (`PUBLIC_API_DOMAIN`) resolving to this VM's IP for HTTPS,
and your Vercel rewrites must point at `https://<that-domain>` — see Step 7.

## Step 3 — Connect to the VM

On your computer, in a terminal:

```bash
chmod 600 your-key.key
ssh -i your-key.key ubuntu@<YOUR-VM-IP>
```

You are now inside the VM.

## Step 4 — Get the code and your .env files onto the VM

Download the code:

```bash
sudo apt-get update -y && sudo apt-get install -y git
git clone https://github.com/<your-username>/anterviewer.git
cd anterviewer
```

Now copy your **`.env` files** onto the VM (they are not in GitHub). From **your
own computer** (open a second terminal), run this once per service:

```bash
scp -i your-key.key services/data_gateway/.env      ubuntu@<VM-IP>:~/anterviewer/services/data_gateway/.env
scp -i your-key.key services/interview_core/.env    ubuntu@<VM-IP>:~/anterviewer/services/interview_core/.env
scp -i your-key.key services/feedback_billing/.env  ubuntu@<VM-IP>:~/anterviewer/services/feedback_billing/.env
scp -i your-key.key services/admin_ops/.env         ubuntu@<VM-IP>:~/anterviewer/services/admin_ops/.env
```

(Make sure `services/data_gateway/.env` has your JDoodle credentials — see "Before you start".)

## Step 5 — Run the one-command setup (back inside the VM)

```bash
cd ~/anterviewer
sudo PUBLIC_WEB_ORIGIN=https://your-app.vercel.app ./scripts/oracle-setup.sh
```

This installs Docker, opens the firewall, builds the images (first build takes a
few minutes), starts all 5 containers, and sets up the database tables.

## Step 6 — Check it's alive

```bash
curl http://localhost:8002/health/live     # should print {"status":"alive"}
```
Do the same for 8001, 8003, 8004. To watch logs: `docker compose --env-file deploy.env -f docker-compose.prod.yml logs -f`.

## Step 7 — Connect the website (Vercel)

1. In `web/vercel.json`, point the 4 rewrites at your VM's IP:
   - gateway → `http://<VM-IP>:8002`
   - interview → `http://<VM-IP>:8001`
   - feedback → `http://<VM-IP>:8003`
   - admin → `http://<VM-IP>:8004`
2. Set the Vercel env vars (`VITE_API_BASE_URL=/api/gateway`, etc. — see
   `docs/DEPLOY-SIMPLE.md` Section 8) and **redeploy** the frontend.

The browser only talks to Vercel (HTTPS); Vercel forwards to your VM. So the VM
can stay plain HTTP — no certificate setup needed.

## Step 8 — Make yourself admin, then test

```bash
docker compose --env-file deploy.env -f docker-compose.prod.yml exec -T admin_ops \
  python scripts/grant_admin.py YOUR_EMAIL
```
(Register that email on the website first.) Then open your Vercel link and test:
login → MCQ exam → **coding exam (uses JDoodle)** → interview → scorecard → admin.

---

## Everyday commands (run inside `~/anterviewer`)

```bash
C="docker compose --env-file deploy.env -f docker-compose.prod.yml"
$C ps                 # status of all containers
$C logs -f data_gateway   # watch one service
$C restart data_gateway   # restart one
$C down               # stop everything
$C up -d --build      # rebuild + start (after a git pull)
```

## If something breaks

| Problem | Cause | Fix |
|---|---|---|
| Can't reach `http://VM-IP:8002` from outside | Ports not open in OCI Console | Step 2 (Security List ingress) |
| Health works locally but not from browser | Same — OCI ingress missing | Step 2 |
| Coding exam fails / shows 0 | JDoodle creds missing/wrong, or 200/day limit hit | Check `JDOODLE_*` in `data_gateway/.env`; check daily credits |
| Exam/interview invite emails link to localhost | `PUBLIC_WEB_ORIGIN` wrong | Fix `deploy.env`, `up -d` again |
| A container keeps restarting | Missing setting in its `.env` | `$C logs <svc>` to see what's missing |
| "CORS" error in browser | Vercel link not allowed | It's set from `PUBLIC_WEB_ORIGIN` — confirm it matches your real Vercel URL |

## Before sharing publicly

- **Rotate all secrets** in the `.env` files (they're in the code history).
- Put **Cloudflare** in front of the VM (login has no rate-limit yet).
- This setup stores data outside India — fine for demos, not for the government bid.
