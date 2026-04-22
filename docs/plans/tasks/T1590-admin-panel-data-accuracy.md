# T1590: Admin Panel Data Accuracy Audit

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-04-20
**Updated:** 2026-04-21

## Problem

The admin panel shows incorrect/missing data for most columns. All activity stats (GAMES, CLIPS, FRAMED, DONE), credit stats (SPENT, PURCHASED), and GPU totals show dashes or zeros even for active users with real data.

Two root causes identified:

### Bug 1: Frontend display — zero treated as falsy (FIXED)

`UserTable.jsx` used `value || '—'` which treats `0` as falsy, showing dashes instead of zeros for every stat column. Fixed 2026-04-20 by changing to `value ?? '—'`.

### Bug 2: Backend can't read user DBs on staging/prod (UNFIXED — critical)

`_compute_activity_counts()`, `_compute_quest_progress()`, and `_compute_gpu_total()` in `admin.py` scan local filesystem paths (`USER_DATA_BASE / user_id / profiles / * / profile.sqlite`). On Fly.io (staging/prod), user databases are only synced from R2 when that user makes an authenticated request — the DB sync middleware pulls their DB on demand.

The admin endpoint **never triggers a DB sync**, so it can only see data for users whose DBs happen to be cached on that particular Fly.io machine. Most users' profile DBs won't exist locally, so the admin panel reports zeros.

This affects: GAMES, CLIPS, FRAMED, DONE, Q1-Q4, GPU columns.

### Additional issues

- `user_db.py:get_credit_stats_for_admin()` line 524 has an `if any(v ...)` filter that excludes users with zero spending from the stats dict. Not harmful (defaults to 0 in `admin.py:334`) but wasteful and confusing.
- No validation that admin panel data matches what users see in their own accounts.
- "Active (7d)" filter relies on `last_seen_at` from auth.sqlite — needs verification that this updates reliably.
- GPU drilldown button may show wrong values for the same DB-not-synced reason.

## Solution

The admin endpoint needs to temporarily sync (or read from R2) each user's profile DB before computing stats. Options:

### Option A: Pull DBs from R2 on demand (simplest)
For each user in the admin list, download their profile.sqlite(s) from R2 into a temp dir, run the stats queries, then discard. Slow for many users but correct.

### Option B: Maintain a read-only cache
On admin request, sync all user DBs that haven't been synced recently (e.g., last 1 hour). Cache the synced DBs for subsequent admin requests.

### Option C: Aggregate stats in auth.sqlite
Move activity counts into auth.sqlite (the one DB the admin always has). Update counts via post-commit hooks or periodic batch job. Fast reads but eventually consistent.

**Recommendation:** Start with Option A for correctness. If too slow (>10s for the user list), migrate to Option C.

## Context

### Relevant Files
- `src/frontend/src/components/admin/UserTable.jsx` — display bug (FIXED)
- `src/backend/app/routers/admin.py` — `_compute_activity_counts()`, `_compute_quest_progress()`, `_compute_gpu_total()`, `_get_user_stats()`
- `src/backend/app/services/user_db.py` — `get_credit_stats_for_admin()` filtering logic
- `src/backend/app/services/auth_db.py` — `get_all_users_for_admin()`, `last_seen_at`
- `src/backend/app/database.py` — `USER_DATA_BASE` path, DB sync logic
- `src/backend/app/middleware/db_sync.py` — R2 sync middleware (reference for how sync works)

### Related Tasks
- T1570 (Admin Panel Missing Users) — DONE, fixed query to include all auth.sqlite users
- T550 (Admin Panel) — original implementation
- T1510 (Admin Impersonate User) — DONE, uses same user list

## Implementation

### Steps
1. [x] Fix frontend display bug (`||` → `??`) — done 2026-04-20
2. [x] Fix credit stats to read from per-user `user.sqlite` instead of stale `auth.sqlite` — done 2026-04-21 (commit c723af1)
3. [ ] Add R2 DB pull to admin stats computation for profile DBs
4. [ ] Fix `get_credit_stats_for_admin()` unnecessary filtering
5. [ ] Verify quest progress matches user-facing quest panel
6. [ ] Verify GPU totals match per-user drilldown
7. [ ] Test with real staging users who have known activity

### Code-Level Findings (2026-04-21)

**Affected functions in `src/backend/app/routers/admin.py`:**
- `_compute_activity_counts()` (lines 234-281) — scans `USER_DATA_BASE / user_id / profiles / * / profile.sqlite` locally
- `_compute_quest_progress()` (lines 181-231) — same local-only scan
- `_compute_gpu_total()` (lines 300-321) — same local-only scan
- None of these call any R2 sync — they rely entirely on locally cached files

**Why this fails on Fly.io:** The DB sync middleware (`db_sync.py`) only pulls a user's profile DB from R2 when that user makes an authenticated request. Admin endpoints bypass this entirely, so profile DBs for most users simply don't exist on the local machine.

**Credit stats partial fix:** `get_credit_stats_for_admin()` in `user_db.py` (lines 472-538) now reads from per-user `user.sqlite`, but still scans local filesystem only (no R2 pull). Works if files happen to be cached, misses users whose DBs haven't been synced recently.

**Remaining work is the core of the task:** Implement Option A (pull profile DBs from R2 on demand) or Option C (aggregate stats into auth.sqlite) for the activity/quest/GPU columns.

## Acceptance Criteria

- [ ] All admin panel columns show accurate data on staging/prod
- [ ] Activity counts (games, clips, framed, done) reflect real user data from R2
- [ ] Quest progress matches what users see in their own quest panel
- [ ] GPU totals are accurate across all profiles
- [ ] Zero values display as "0" not dashes (DONE)
- [ ] Credit stats include users with zero spending
