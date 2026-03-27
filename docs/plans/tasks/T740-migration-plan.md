# T740 Migration Plan: Merge Extraction into Framing

## Overview

Deploy the `feature/T740-merge-extraction-into-framing` branch to staging and production.
This eliminates the separate clip extraction step — framing now reads directly from the
source game video using start/end times.

## Pre-Deploy Assessment

**Data impact: NONE.** No schema migrations. No data loss. Existing accounts work as-is.

| Existing Data | Impact | Action |
|---|---|---|
| `raw_clips` with `filename` | Ignored — code uses `game_id` path | None |
| `raw_clips` without `filename` | No longer blocks framing (the fix!) | None |
| `modal_tasks` (extraction queue) | Orphaned, never processed | Harmless |
| `working_videos` | Still valid | None |
| `export_jobs` | Still valid | None |
| Quest progress | Step counts 5→4, auto-recalculates | None |
| R2 `raw_clips/` files | Orphaned | Optional cleanup later |

**Modal backward compatibility: SAFE.** New function signatures have defaults:
`source_start_time: float = 0.0, source_end_time: float = None`. Old callers that
don't pass these get the old behavior (process full video from start).

## Execution Steps

### Step 1: Merge to master

```bash
cd c:/Users/imank/projects/video-editor
git checkout master
git merge feature/T740-merge-extraction-into-framing
git push origin master
```

This triggers GitHub Actions:
- Auto-deploy frontend to staging (Cloudflare Pages)
- Auto-deploy backend to staging (Fly.io)

### Step 2: Deploy Modal functions

```bash
cd src/backend && PYTHONUTF8=1 .venv/Scripts/python.exe -m modal deploy app/modal_functions/video_processing.py
```

Safe because new params have defaults — old callers still work.

### Step 3: Verify staging

Test these on staging:
- [ ] Open existing project → framing loads without extraction wait
- [ ] Video preview shows correct clip segment (not full game)
- [ ] Duration shows clip length, not game length
- [ ] Export framing → correct clip range in output
- [ ] Quest 2 shows 4 steps, completes correctly
- [ ] Annotate ↔ Framing navigation preserves clip selection
- [ ] No "waiting for extraction" messages anywhere

### Step 4: Production deploy

Production backend deployment depends on T105 status. If prod auto-deploys
from master, it already happened at Step 1. If manual:

```bash
# Deploy production backend (when T105 is ready)
# fly deploy --config fly.prod.toml
```

### Step 5: Verify production

Same tests as Step 3 on production.

### Step 6: Optional cleanup (low priority, post-verification)

```bash
# Delete orphaned extracted clip files from R2 to save storage
# Only after confirming everything works
# NOT URGENT — just duplicated data

# List accounts to audit:
cd src/backend && .venv/Scripts/python.exe -c "
from app.database import get_auth_db_connection
with get_auth_db_connection() as conn:
    users = conn.execute('SELECT id, email FROM users').fetchall()
    for u in users:
        print(f'{u[\"id\"]} - {u[\"email\"]}')
"
```

## Rollback Plan

The change is reversible — revert the merge commit and redeploy. Modal functions
are backward-compatible (defaults), so no Modal rollback needed.

```bash
git revert <merge-commit-hash>
git push origin master
# Auto-deploys reverted code to staging
```

## Status

- [ ] Step 1: Merge to master
- [ ] Step 2: Deploy Modal functions
- [ ] Step 3: Verify staging
- [ ] Step 4: Production deploy
- [ ] Step 5: Verify production
- [ ] Step 6: Optional R2 cleanup
