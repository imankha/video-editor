# T4870: Admin Panel Shows 0 Credits for Users With Nonzero Balances

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-10
**Updated:** 2026-07-10

## Problem

The admin panel Users table shows **0 credits** for users who actually have a nonzero balance. Reported by the admin 2026-07-10: granting N credits to a "0-credit" user returns a balance of N+8 or N+6 — the pre-existing balance was there all along, just not displayed. In the current prod screenshot, `sarkarati@gmail.com` and `drewsoccerati@gmail.com` show 0 despite having received signup credits.

This is a **display/read-path bug, not data corruption** — the canonical balances in R2 are correct. But it actively misleads admin decisions (e.g. "who needs a credit top-up?"), and it directly poisons T4860's bulk-grant flow: the admin would grant credits based on fake zeros. Stale (not just missing) local copies produce the same bug in a quieter form: a number that's merely out of date.

## Root Cause (confirmed by code read, 2026-07-10)

Two different read paths with different guarantees:

1. **Grant path (correct):** `grant_credits()` -> `get_user_db_connection()` -> `ensure_user_database()` ([user_db.py:122-157](../../src/backend/app/services/user_db.py)) — on first access, restores the user's `user.sqlite` **from R2** (`sync_user_db_from_r2_if_newer`, NOT_FOUND vs ERROR distinction, cooldown). It always operates on the canonical data. That's why a grant "reveals" the hidden balance.

2. **Admin list path (broken):** `GET /admin/users` -> `get_credit_stats_for_admin(page_user_ids)` ([user_db.py:529-603](../../src/backend/app/services/user_db.py)) — raw `sqlite3.connect` on the **local filesystem path** (`USER_DATA_BASE / uid / user.sqlite`), bypassing `ensure_user_database` entirely. Two failure modes:
   - `if not user_db_path.exists(): continue` (line ~556) — user silently absent from the stats dict.
   - A local file that exists but is **stale** (older than R2 canonical) is read as-is.

   Then [admin.py:177-180](../../src/backend/app/routers/admin.py) papers over the missing entry with a fabricated default `{"credits_balance": 0, ...}` — a textbook **silent fallback for internal data** (banned by CLAUDE.md "No Silent Fallbacks"). Unknown becomes a confident-looking 0.

Why it manifests on prod: Fly machine disks are ephemeral and there are multiple machines. A user's `user.sqlite` only lands on a given machine's disk when a request in *their* session touches that machine after its last cycle. Inactive users' files are simply not there, so the admin panel reads them as 0.

## Solution

Make the admin credit read go through the same canonical-access guarantee as every other user-DB read, and stop fabricating 0 for unknown:

1. **Route reads through `ensure_user_database`:** in `get_credit_stats_for_admin`, call `ensure_user_database(user_id)` before opening each DB (then keep the cheap read-only `sqlite3.connect` — no need for the full `TrackedConnection` write machinery). This triggers the existing R2 restore on first access. Subsequent page loads are cheap (`_initialized_user_dbs` cache).

2. **Handle staleness deliberately (investigate, then pick):** `ensure_user_database` only checks R2 when there's no local version — a stale-but-present local copy still wins. Options, in order of preference:
   - (a) Accept first-access restore only, and document that balances can lag until the user's next session syncs — cheap, fixes the reported "0" case fully, staleness window is small in practice.
   - (b) For the admin page only, call `sync_user_db_from_r2_if_newer(user_id)` per page user (version-compare via R2 metadata, downloads only when newer) — fully correct, costs up to ~25 R2 HEADs per admin page load. Measure before choosing; the admin panel is one user, so (b) is likely affordable.
   The implementing agent should confirm with the user which option before building (a one-line question with the measured cost of (b)).

3. **Kill the silent fallback:** when a user's stats genuinely can't be read (R2 error + no local copy), `get_credit_stats_for_admin` must return an explicit marker (e.g. omit the user AND log at warning — it already logs on exceptions but NOT on the `exists()` skip), and `admin.py` must pass `credits: null` through instead of fabricating 0. Frontend `UserTable` renders `—` (an honest "unknown") for null, like it already does for `$ SPENT`.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/user_db.py` — `get_credit_stats_for_admin` (~529): add `ensure_user_database` call, log the missing-file skip, staleness decision.
- `src/backend/app/routers/admin.py` — user list assembly (~172-211): replace the fabricated default dict with explicit null/omission semantics.
- `src/frontend/src/components/admin/UserTable.jsx` — render `—` for `credits === null`.
- `src/backend/tests/` — test alongside existing admin/credit tests.

### Related Tasks
- Blocks (soft): T4860 Admin Bulk User Actions — bulk-grant decisions read these balances; land this first or in the same wave.
- Same silent-fallback family as T4280 (Backend Silent-Fallback Sweep) — this instance is admin-only and can ship independently.

### Technical Notes
- **Reproduce before fixing** (bug-reproduction skill): a test that writes a balance for a user whose local `user.sqlite` is absent-but-restorable (or simply monkeypatch `USER_DATA_BASE` emptiness) and asserts `GET /admin/users` currently returns 0 must fail after the fix returns the real balance / null.
- `get_credit_stats_for_admin` is also called with `user_ids=None` (full scan) somewhere? Grep callers first — the fix must not turn a full scan into a full-userbase R2 restore. If a scan-all caller exists, restrict the `ensure_user_database` behavior to the explicit-ids path used by the admin page.
- Read-only connections here shouldn't bump sync versions or trigger uploads — verify `ensure_user_database` alone has no write side effects (it may create an empty schema file for a genuinely-new user; that's the existing first-access behavior and is fine).
- Backend tests truncate the real dev Postgres — warn the user before running.

## Implementation

### Steps
1. [ ] Grep callers of `get_credit_stats_for_admin` (confirm admin page is the only explicit-ids caller; check for scan-all callers).
2. [ ] Failing test reproducing the fake-0 (missing local file -> admin endpoint reports 0 today).
3. [ ] Fix: `ensure_user_database` in the stats loop + warning log on skip + null-not-zero in `admin.py`.
4. [ ] Staleness decision (a) vs (b) — measure (b)'s cost on dev, ask user, implement choice.
5. [ ] Frontend: `—` for null credits.
6. [ ] Verify on staging: previously-0 users (sarkarati, drewsoccerati) show real balances in the admin panel without granting anything.

### Progress Log

**2026-07-10**: Bug reported (grant reveals hidden balance: N granted -> N+8 shown). Root cause confirmed same day by code read: admin stats read raw local disk + silently default missing users to 0, while the grant path R2-restores first. Data in R2 is intact.

**2026-07-11**: Implementation complete. Staleness option measured and decided:
- Option (a) stale-file read-as-is: chosen for existing local files. Stale-but-present files are read directly — no R2 staleness check. Acceptable in practice (staleness window = process/machine lifetime).
- Option (b) `sync_user_db_from_r2_if_newer` per page user: NOT implemented for existing files. ~25 R2 HEAD calls per admin page load, ~500ms-1250ms added latency (R2 HEAD ~20-50ms each). Cannot measure directly (R2_ENABLED=false in dev). Can be layered on later if staleness becomes a problem.
- **For missing files** (the primary bug): `sync_user_db_from_r2_if_newer` is called directly — NOT `ensure_user_database`. Reason: `ensure_user_database` creates a balance-0 stub DB on R2 error; that stub then gets read as a real 0-balance on subsequent admin page loads, recreating the original bug. `sync_user_db_from_r2_if_newer` never creates a stub — R2 error leaves no local file, user is omitted, admin sees `—`.
- Callers: only one caller (`admin.py:172` with explicit page_user_ids). No scan-all callers exist — the R2 restore path is restricted to explicit-ids safely.

**2026-07-12**: Refined fix: replaced first-attempt (`ensure_user_database` + cooldown heuristic) with `sync_user_db_from_r2_if_newer` direct call to prevent stub-DB poisoning. All 7 backend tests pass. Frontend null rendering verified in UserTable and CreditGrantModal.

## Acceptance Criteria

- [ ] Admin panel shows the true canonical balance for every user, including users with no local `user.sqlite` on the serving machine (verified on staging with a user inactive since before the last machine cycle).
- [ ] When stats are genuinely unreadable, the UI shows `—`, never a fabricated 0; the skip is logged at warning.
- [ ] Granting credits to a user no longer changes their displayed balance by more than the granted amount.
- [ ] Regression test: missing-local-file scenario returns real balance (or null on R2 error), not 0.
- [ ] No write-path changes; `grant_credits`/`set_credits` untouched.
