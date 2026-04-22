# T1590: Admin Panel Data Accuracy Audit

**Status:** TESTING
**Impact:** 5
**Complexity:** 5
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

- `user_db.py:get_credit_stats_for_admin()` line 531 has an `if any(v ...)` filter that excludes users with zero spending from the stats dict. Not harmful (defaults to 0 in `admin.py:334`) but wasteful and confusing.
- No validation that admin panel data matches what users see in their own accounts.
- "Active (7d)" filter relies on `last_seen_at` from auth.sqlite — needs verification that this updates reliably.
- GPU drilldown button may show wrong values for the same DB-not-synced reason.

## Solution: Profile-Centric Architecture with R2 Pull and Pagination

### Design change: profiles as the primary unit

The current admin panel aggregates stats across all of a user's profiles into one row per user. The new design makes **profiles** the primary row unit:

- **Most users have 1 profile** — they get 1 row (looks the same as today).
- **Users with multiple profiles** — grouped rows: a parent row showing the user's email with an expand toggle, child rows (one per profile) indented beneath it, each with their own activity stats.
- **Profile ID** (8-char hex) visible on each profile row.
- **Activity columns become per-profile**: GAMES, CLIPS, FRAMED, DONE, Q1-Q4, GPU. No more cross-profile aggregation.
- **User-level columns stay on the parent row**: EMAIL, CREDITS, SPENT, PURCHASED, $ SPENT, LAST SEEN. Credits live in `user.sqlite`, not `profile.sqlite` — currency is per-user, not per-profile.

This simplifies the backend — stat functions take a single profile DB path instead of looping and merging across profiles.

### Capacity-driven pagination

Page size is determined by how many concurrent R2 downloads + SQLite queries the server can handle without timing out. Pagination is measured in **profiles**, not users (a user with 3 profiles counts as 3).

**Pagination flow:**
1. `get_all_users_for_admin()` — list all users from auth.sqlite (fast, no R2)
2. For each user, list R2 objects matching `{APP_ENV}/users/{user_id}/profiles/` to discover profile IDs (metadata only, no DB downloads)
3. Build flat list of (user, profile_id) pairs, compute `total_profiles`
4. Slice to current page
5. For profiles in this page only: download `profile.sqlite` from R2 if not cached locally
6. Run stat queries on downloaded DBs
7. Group results back by user for response

**API**: `GET /api/admin/users?page=1&page_size=N`

**Response shape:**
```json
{
  "users": [
    {
      "user_id": "abc123",
      "email": "user@example.com",
      "credits": 50,
      "credits_spent": 120,
      "credits_purchased": 200,
      "money_spent_cents": 499,
      "last_seen_at": "2026-04-20T...",
      "profiles": [
        {
          "profile_id": "a1b2c3d4",
          "games_annotated": 3,
          "clips_annotated": 15,
          "projects_framed": 2,
          "projects_completed": 1,
          "quest_progress": { ... },
          "gpu_seconds_total": 45.2
        }
      ]
    }
  ],
  "page": 1,
  "page_size": 10,
  "total_profiles": 47,
  "total_pages": 5
}
```

### R2 access for admin

Existing `download_from_r2()` and `r2_key()` depend on a profile_id ContextVar not set in admin context. Admin code must construct R2 keys directly:
- Profile DB key: `{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite`
- User DB key: via `r2_user_key(user_id, "user.sqlite")`
- Use `get_r2_client()`, `R2_BUCKET`, `APP_ENV` from `app.storage`
- Download to standard `USER_DATA_BASE` paths so subsequent requests benefit from cache
- Wrap synchronous R2 calls in `asyncio.to_thread()` from async context

## Context

### Relevant Files

**Backend (modify):**
- `src/backend/app/routers/admin.py` — R2 pull helper, pagination, profile-centric stats, GPU drilldown
- `src/backend/app/services/user_db.py` — remove unnecessary filter in `get_credit_stats_for_admin()`

**Frontend (modify):**
- `src/frontend/src/stores/adminStore.js` — paginated fetch, page state
- `src/frontend/src/components/admin/UserTable.jsx` — grouped profile rows, pagination controls

**Read for context (do not modify):**
- `src/backend/app/storage.py` — `get_r2_client`, `R2_BUCKET`, `APP_ENV`, `download_from_r2`, `list_r2_files`, `r2_key`
- `src/backend/app/database.py` — `USER_DATA_BASE` path constant
- `src/backend/app/middleware/db_sync.py` — how normal request sync works (reference only)
- `src/backend/app/services/auth_db.py` — `get_all_users_for_admin()`, `last_seen_at`

### Related Tasks
- T1570 (Admin Panel Missing Users) — DONE, fixed query to include all auth.sqlite users
- T550 (Admin Panel) — original implementation
- T1510 (Admin Impersonate User) — DONE, uses same user list

## Implementation

### Steps
1. [x] Fix frontend display bug (`||` -> `??`) — done 2026-04-20
2. [x] Fix credit stats to read from per-user `user.sqlite` instead of stale `auth.sqlite` — done 2026-04-21 (commit c723af1)
3. [x] Create admin R2 download helper (bypasses ContextVar, downloads to standard paths)
4. [x] Create admin profile discovery helper (list R2 objects to find profile IDs per user)
5. [x] Refactor stat functions to single-profile (one db_path, no aggregation loop)
6. [x] Add pagination to GET /api/admin/users (capacity-driven page size)
7. [x] Build profile-centric response shape (profiles nested under users)
8. [x] Fix GPU drilldown endpoint to accept profile_id and pull from R2
9. [x] Fix `get_credit_stats_for_admin()` unnecessary filter (line 531)
10. [x] Update adminStore.js for paginated fetch and page state
11. [x] Update UserTable.jsx: grouped profile rows, expand toggle for multi-profile users
12. [x] Add pagination controls to UserTable.jsx
13. [ ] Test with real staging users who have known activity

### Code-Level Findings (2026-04-21)

**Affected functions in `src/backend/app/routers/admin.py`:**
- `_compute_activity_counts()` (lines 234-281) — loops across profiles, aggregates. Refactor to single db_path.
- `_compute_quest_progress()` (lines 181-231) — merges steps across profiles. Refactor to single db_path.
- `_compute_gpu_total()` (lines 300-321) — loops across profiles. Refactor to single db_path.
- `_get_profile_db_paths()` (lines 59-64) — globs local filesystem only. Replace with R2 listing.
- None of these call any R2 sync — they rely entirely on locally cached files.

**R2 ContextVar problem:** `r2_key()` (storage.py:209) reads `get_current_profile_id()` from a ContextVar. Admin endpoints don't set this. Must construct keys manually: `f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite"`.

**Credit stats are user-level:** `get_credit_stats_for_admin()` reads `user.sqlite` (not profile.sqlite). Currency is per-user. These stats stay on the user row, not profile rows.

## Acceptance Criteria

- [ ] Admin panel shows per-profile rows with accurate activity data from R2
- [ ] Single-profile users render as one flat row (no expand toggle)
- [ ] Multi-profile users render as grouped rows with expand/collapse
- [ ] User-level columns (email, credits, spent, purchased, last seen) on parent row
- [ ] Profile-level columns (games, clips, framed, done, quests, GPU) on profile rows
- [ ] Pagination works: page forward/back loads next batch of profiles from R2
- [ ] GPU drilldown works per-profile with R2 pull
- [ ] Quest progress per-profile matches what users see
- [ ] Zero values display as "0" not dashes (DONE)
- [ ] Credit stats include users with zero spending
