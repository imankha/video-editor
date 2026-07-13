# T4970: Admin user enumeration misses users without user_segments rows

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

Users who have no `user_segments` row are INVISIBLE to every admin surface that
enumerates users. Confirmed live on staging 2026-07-12: the test account
`e2e@test.local` (user `2d12bbda-26b8-49fc-afe2-29c045cab3fd`) exists in
`users`, owns games/reels/credits, but:

- does not appear in `GET /api/admin/users` (5 users listed, not 6), and
- is silently skipped by `POST /api/admin/backfill-share-posters`
  (`scanned: 0` even though it had a published poster-less reel at probe time),
  because the backfill iterates `get_all_users_for_admin()`.

This was previously observed for copied accounts (see memory
"Copy Account Script": missing user_segments = invisible in admin dashboard —
inner join) but never fixed at the source. The blast radius is every consumer
of `get_all_users_for_admin()`: the admin dashboard, credit stats, poster
backfill, and any future all-users admin sweep — each silently under-covers.

## Solution

Two candidate fixes — the Implementor investigates step 1 and picks per the
decision rule:

- **(A) Fix the query**: if `user_segments` is a lazily-computed analytics
  classification (a user legitimately has no row until the analytics job runs),
  the inner join is simply wrong for enumeration — change
  `get_all_users_for_admin()` to `LEFT JOIN` and return NULL segment fields.
- **(B) Fix the data**: if the intended invariant is "every user always has a
  user_segments row" (created at signup), then per the Correct-Data principle,
  create the row at user creation AND ship a postgres-track migration
  backfilling a default row for existing users missing one.

**Decision rule**: read where `user_segments` rows are normally created
(analytics pipeline vs signup). If any code path creates users without
segments BY DESIGN (test-login does; copied accounts do), option (A) is
correct — enumeration must not depend on an optional analytics table. (B) may
ADDITIONALLY be desirable but is an analytics-team call; do not silently
invent segment values for real users.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/auth_db.py` — `get_all_users_for_admin()` (the join)
- `src/backend/app/routers/admin.py` — admin users list + poster backfill (consumers)
- `src/backend/app/services/user_db.py` — `get_credit_stats_for_admin` (consumer via ids)
- `src/backend/app/services/poster.py` — `backfill_posters` (consumer)
- `src/backend/app/migrations/postgres/` — only if option (B) chosen

### Related Tasks
- T4870 (admin credits null-not-zero) — same admin surface; T4870's fix is
  already on staging; this task removes the remaining enumeration gap.
- T4860 (bulk user actions) — bulk grants iterate the same list; without this
  fix, segmentless users can't be bulk-granted.

### Technical Notes
- Verify with the staging test account (memory: "Staging test account"):
  after the fix, `GET /api/admin/users` must list `e2e@test.local`, and a
  poster-backfill dry-run must scan its profile.
- The admin UI may assume segment fields are non-null — check the UserTable
  render for the LEFT-JOIN NULLs and display `—` (T4870 established the
  null-not-fabricated pattern).

## Implementation

### Steps
1. [ ] Read `user_segments` writers; document (in this file) which flows create
       users without a row. Pick option per the decision rule (expected: A).
2. [ ] Change the join; return explicit NULLs for missing segment fields.
3. [ ] Update UserTable/consumers for NULL segment fields (`—`).
4. [ ] Backend test: create a user with no user_segments row (pg_conn fixture),
       assert `get_all_users_for_admin()` includes it and the poster backfill
       scans it (dry_run counts its candidates).
5. [ ] Staging verification: `e2e@test.local` appears in admin users; poster
       backfill dry-run scans >= 1 profile for it.

### Progress Log

**2026-07-12**: Surfaced during the derisk sweep (T4870 grant probe + poster
backfill probe). Grant-by-user-id works fine — only ENUMERATION misses them.

## Acceptance Criteria

- [ ] A user with no `user_segments` row appears in `GET /api/admin/users`
- [ ] `backfill_share_posters` dry-run scans that user's profiles
- [ ] Segment columns render as `—` (never fabricated values) for such users
- [ ] Backend test covering the segmentless-user enumeration passes
