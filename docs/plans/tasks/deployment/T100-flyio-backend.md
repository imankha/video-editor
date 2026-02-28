# T100: Fly.io Staging Backend

**Status:** TODO
**Impact:** 5
**Complexity:** 3

## Overview
Deploy the FastAPI backend to Fly.io **staging only**. Uses scale-to-zero for minimal cost during testing.

Production deployment is separate (T105) to allow proper capacity planning.

## Prerequisites (User Must Complete)
- Fly.io account created (free)
- `flyctl` CLI installed: `powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"`
- `fly auth login` completed

## Deliverables

| File | Purpose |
|------|---------|
| `src/backend/Dockerfile` | Production container (Python 3.11 slim + ffmpeg) |
| `src/backend/fly.staging.toml` | Fly.io staging config (scale-to-zero) |
| `src/backend/.dockerignore` | Exclude venv, tests, dev files |
| CORS update in `main.py` | Accept staging frontend origin via env var |

---

## Architecture Context

### App Entry Point
- `src/backend/app/main.py` — FastAPI app with middleware stack
- Startup: `uvicorn app.main:app --host 0.0.0.0 --port 8080`
- Working directory must be `src/backend/` (imports use `app.` prefix)

### Middleware Stack (order matters)
1. **CORS** (`main.py:114-125`) — Currently hardcoded to `localhost:5173` and `localhost:3000`. **Must be updated** to read allowed origins from `CORS_ORIGINS` env var while keeping localhost for local dev.
2. **UserContextMiddleware** (`main.py:69-101`) — Extracts `X-User-ID` and `X-Profile-ID` headers
3. **DatabaseSyncMiddleware** (`app/middleware.py`) — Syncs SQLite to R2 at request boundaries

### Storage Architecture
- **R2 is the source of truth** — SQLite DB synced to/from R2 per request
- **No local video storage** needed when R2 is enabled — videos served via presigned URLs
- Local filesystem only used for: `user_data/{user_id}/profiles/{profile_id}/database.sqlite` (cache)
- The `user_data/` directory is at project root level (4 levels up from `app/`): `Path(__file__).parent.parent.parent.parent / "user_data"`

### GPU Processing
- All GPU work offloaded to Modal (remote) — backend just calls Modal API over network
- Modal functions deployed separately (not part of this container)
- `MODAL_ENABLED=true` + token env vars required

### WebSocket Endpoints
- `/ws/export/{export_id}` — export progress
- `/ws/extractions` — clip extraction status
- Fly.io supports WebSockets natively, no special config needed

### Health Check
- `GET /api/health` already exists — use for Fly.io health checks

### Git Version Logging
- `main.py:165-206` calls `git rev-parse` at startup for version logging
- Will fail gracefully in container (already wrapped in try/except, logs warning)
- Not a blocker

---

## Environment Variables

### Required (set via `fly secrets set`)
```bash
R2_ENABLED=true
R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<from .env>
R2_SECRET_ACCESS_KEY=<from .env>
R2_BUCKET=reel-ballers-users
MODAL_ENABLED=true
MODAL_TOKEN_ID=<from ~/.modal.toml>
MODAL_TOKEN_SECRET=<from ~/.modal.toml>
```

### Set in fly.toml `[env]` (non-secret)
```
ENV=staging
APP_ENV=staging
DEBUG=false
CLEAR_PENDING_JOBS_ON_STARTUP=false
CORS_ORIGINS=https://reel-ballers-staging.pages.dev
```

### Env var names used in code
| Var | File | Usage |
|-----|------|-------|
| `ENV` | `main.py:104` | `"development"` or `"staging"` — controls error verbosity |
| `DEBUG` | `main.py:42` | Logging level (DEBUG vs INFO) |
| `APP_ENV` | `storage.py:27` | R2 key prefix (`dev/` vs `staging/`) — **important for data isolation** |
| `R2_ENABLED` | `storage.py:30` | Toggle cloud storage |
| `R2_ENDPOINT` | `storage.py:31` | R2 endpoint URL |
| `R2_ACCESS_KEY_ID` | `storage.py:32` | R2 auth |
| `R2_SECRET_ACCESS_KEY` | `storage.py:33` | R2 auth |
| `R2_BUCKET` | `storage.py:34` | R2 bucket name |
| `MODAL_ENABLED` | `services/modal_client.py:129` | Toggle GPU processing |
| `CLEAR_PENDING_JOBS_ON_STARTUP` | `services/export_worker.py:533` | Dev flag; `false` for prod |

---

## Dependencies
- `src/backend/requirements.prod.txt` — Already exists, excludes GPU deps (torch, CUDA, YOLO, Real-ESRGAN)
- Needs system package: `ffmpeg` (used via subprocess for video processing)
- Python 3.11

---

## CORS Change Details

**Current** (`main.py:114-125`):
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Sync-Status"],
)
```

**Target**: Read from `CORS_ORIGINS` env var (comma-separated), always include localhost for dev:
```python
_cors_extra = os.getenv("CORS_ORIGINS", "")
_cors_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
]
if _cors_extra:
    _cors_origins.extend(origin.strip() for origin in _cors_extra.split(",") if origin.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    ...
)
```

---

## Fly.io Configuration

### fly.staging.toml
```toml
app = "reel-ballers-api-staging"
primary_region = "lax"  # Los Angeles

[build]
  dockerfile = "Dockerfile"

[env]
  ENV = "staging"
  APP_ENV = "staging"
  DEBUG = "false"
  CLEAR_PENDING_JOBS_ON_STARTUP = "false"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type = "requests"
    hard_limit = 250
    soft_limit = 200

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

### Dockerfile
```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.prod.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### .dockerignore
```
.venv/
__pycache__/
tests/
*.pyc
.pytest_cache/
user_data/
weights/
*.db
*.sqlite
```

---

## Deploy Commands

```bash
cd src/backend

# Create app
fly apps create reel-ballers-api-staging

# Set secrets (from .env and ~/.modal.toml)
fly secrets set --app reel-ballers-api-staging \
  R2_ENABLED=true \
  R2_ENDPOINT=<value> \
  R2_ACCESS_KEY_ID=<value> \
  R2_SECRET_ACCESS_KEY=<value> \
  R2_BUCKET=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=<value> \
  MODAL_TOKEN_SECRET=<value>

# Deploy
fly deploy --config fly.staging.toml

# Verify
curl https://reel-ballers-api-staging.fly.dev/api/health
fly logs --app reel-ballers-api-staging
```

---

## Cost Estimate

| App | Usage | Monthly Cost |
|-----|-------|--------------|
| Staging | Scale-to-zero, occasional testing | ~$0-2 |

Cold start: ~2-3 seconds when waking from zero.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No machines running" | Expected when scaled to zero — first request wakes it |
| Cold start too slow | Set `min_machines_running = 1` (~$5/mo) |
| CORS errors | Check `CORS_ORIGINS` env var includes frontend URL |
| Modal not working | Verify `MODAL_ENABLED=true` and token secrets are set |
| WebSocket disconnects | Ensure frontend uses `wss://` not `ws://` |
| R2 data isolation | Verify `APP_ENV=staging` so data goes to `staging/users/...` not `dev/users/...` |

---

## Next Steps
- T110 — Cloudflare Pages Frontend (deploy React app)
- T105 — Production Backend Scaling (capacity planning)
