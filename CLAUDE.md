# Video Editor - AI Guidelines

## Project Overview
Browser-based video editor with three-mode workflow: **Annotate** (clip extraction from game footage) → **Framing** (crop/upscale) → **Overlay** (highlight effects) → **Gallery** (downloads).

## Philosophy
- **Heavy testing**: Unit tests co-located with code, E2E with Playwright
- **Data always ready**: Frontend assumes data is loaded before rendering
- **MVC pattern**: Screens own state, containers handle logic, views are presentational
- **Single source of truth**: All user data persists in SQLite → synced to R2. Never use localStorage.

## Stack
- **Frontend**: React 18 + Vite + Zustand (port 5173)
- **Backend**: FastAPI + Python (port 8000)
- **Database**: SQLite per-user, synced to R2
- **Storage**: Cloudflare R2
- **GPU**: Modal (cloud) or local FFmpeg + Real-ESRGAN

## Commands
```bash
# Dev servers
cd src/frontend && npm run dev
cd src/backend && uvicorn app.main:app --reload

# Tests
cd src/frontend && npm test           # Unit tests
cd src/frontend && npm run test:e2e   # E2E (start servers first)
cd src/backend && pytest tests/ -v    # Backend tests
```

## Key Docs
- [README.md](README.md) - Full architecture and API reference
- [docs/plans/cloud_migration/PLAN.md](docs/plans/cloud_migration/PLAN.md) - Current deployment plan

## Database Location
- User databases are stored at: `user_data/{user_id}/database.sqlite`
- Default dev user database: `C:\Users\imank\projects\video-editor\user_data\a\database.sqlite`
- R2 bucket: `reel-ballers-users`, synced at `{user_id}/database.sqlite`
- Sync strategy: On startup, download from R2 if newer. On mutations, upload to R2 with version check.
