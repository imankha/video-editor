# T12920: Backend: plays-only game state, keep/restore endpoints, on-demand preservation

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Tier:** L (schema change + new endpoints + background job; Architect design gate, Migration agent)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Epic:** [Keep Only Marked Plays](EPIC.md)

## Problem

There is no per-game way to say "only the plays matter". The only route to a plays-only game is
waiting for storage expiry, which is irreversible and comes with two weeks of nagging.

## Solution

One nullable column plus two gestures, built on the existing preservation function.

### Schema (profile_db migration v057)
- `games.plays_only_at TIMESTAMP NULL`. Set = plays-only. NULL = normal. Nothing else is stored:
  "restorable" is derived (`plays_only_at IS NOT NULL AND storage_status == 'active'`), the
  preservation state is the existing `auto_export_status`.
- Add the column to `ensure_database()`'s `CREATE TABLE games` in `database.py` AND the v057 ALTER
  (ALTER-added-column convention, see v056). Bump `HEAD_VERSION_AUDITED` 56 -> 57 and
  `POST_V023_COLUMNS["games"]` in `test_t6030_migration_window_structural_guard.py` (any `ADD COLUMN`
  must, per annotate.md T11430 note). New-column hot-path window rule applies (readers must
  `column_exists`-guard during the rolling deploy).

### Endpoints (`routers/games.py`)
- `POST /api/games/{id}/plays-only` ("Keep only marked plays")
  - Preconditions, 409 with a `code` otherwise: owned game (not a reference, `source_profile_id IS NULL`),
    `status == 'ready'`, `storage_status == 'active'`, `clip_count >= 1`, not a pool game.
  - Sets `plays_only_at = now`, then schedules preservation (D4): `auto_export_game(user_id, profile_id, game_id)`.
    Idempotent: a game already `complete` returns immediately.
  - Returns `{plays_only: true, preservation: 'complete' | 'pending'}`.
- `DELETE /api/games/{id}/plays-only` ("Restore full video")
  - Allowed only while `storage_status == 'active'` (the ref is live). 409 `code: 'source_expired'` otherwise.
  - Clears `plays_only_at`. Per D5: deletes the recap objects for both layers (`recap_r2_keys`) and resets
    `auto_export_status = NULL, auto_export_attempts = 0` so the normal expiry sweep rebuilds a fresh recap
    later; KEEPS per-play extracts (`raw_clips.filename`) because T4175 drafts may reference them.
    If the user rejects D5, the alternative is to make `recap-data` prefer the game video for live games.
- `GET /api/games` (`list_games`) and `GET /api/games/{id}/load` emit `plays_only: bool` and
  `preservation_status` (the `auto_export_status` value). `load` for a plays-only game still returns the
  video URL (the frontend decides what to show); the Annotate editor is blocked client-side (T12930) and
  clip create/update writes on a plays-only game are refused server-side with 409 `code: 'plays_only'` so
  a stale tab cannot mark plays into a game that is being presented as frozen.

### Background execution (landmine)
`auto_export_game` was written for the sweep: it sets ContextVars itself, opens its own connections and
syncs the DB to R2 explicitly. It must NOT be called inline from a request that already holds the
per-(user, profile) seam (T8190-class self-deadlock, see CLAUDE.md Migration System). Run it after the
response via the same out-of-request pattern the sweep uses (asyncio task with its own context), and
make the request's own write (the flag) sync through the normal middleware path first. The architect
decides between an asyncio background task and the existing sweep loop picking it up on its next tick
(`needs_export` already selects `auto_export_status IS NULL`; a "run soon" nudge may be enough).
Recap stitching runs ffmpeg on the Fly machine at native resolution (T4140); it already does this at
expiry for every game, so no new capacity risk, but note the T7090 OOM precedent for very large games.

### Sweep
No change. A plays-only game at expiry is `complete` (or still selectable if preservation failed), so
`do_sweep` reclaims it exactly like today. Pin that with a test.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` - `CREATE TABLE games` (fresh DDL)
- `src/backend/app/migrations/profile_db/v057_games_plays_only.py` - new
- `src/backend/app/migrations/profile_db/__init__.py` - register v057
- `src/backend/app/routers/games.py` - two endpoints, `list_games`/`load_game` fields, clip-write guard
- `src/backend/app/routers/clips.py` - clip create/update refusal on a plays-only game
- `src/backend/app/services/auto_export.py` - entry point reuse (no behavior change expected)
- `src/backend/app/services/sweep_scheduler.py` - read-only; test only
- `src/backend/tests/test_t6030_migration_window_structural_guard.py` - column audit
- `src/backend/tests/test_t12920_plays_only.py` - new

### Related Tasks
- Depends on: T12910 (every marked play preserved)
- Blocks: T12930, T12940

### Technical Notes
- Knowledge docs: `export-pipeline.md` (Sweep row, `resolve_clip_source`, T4175/T4140), `persistence-sync.md`
  (migration seam, CAS, v056 entry for the ALTER convention), `backend-services.md`.
- Gesture-based persistence: both endpoints are explicit user gestures; nothing reactive.
- No fallbacks: a plays-only game with `auto_export_status='failed'` is a visible state (`preservation_status`),
  never silently re-run from a read path.
- Memory: migration version collisions across branches; hardcoded head tests; new-column hot-path window.

## Implementation

### Steps
1. [ ] Architect design doc `docs/plans/tasks/T12920-design.md` (D4/D5 choices, background execution), user approval
2. [ ] Failing tests: keep -> flag set + preservation scheduled; restore -> flag cleared, recap gone, status reset; preconditions; clip write refused; sweep reclaims a plays-only game
3. [ ] v057 migration + DDL + structural guard
4. [ ] Endpoints + list/load fields
5. [ ] Knowledge docs

### Progress Log

**2026-10-18**: Filed.

## Acceptance Criteria

- [ ] v057 adds `games.plays_only_at`; fresh DDL matches; structural guard updated
- [ ] `POST .../plays-only` sets the flag and leaves the game `auto_export_status='complete'` (or `pending` then `complete`) without a request-path deadlock
- [ ] `DELETE .../plays-only` works only while storage is active and leaves the game indistinguishable from a never-kept game except for extracts
- [ ] `list_games` / `load` expose `plays_only` and `preservation_status`
- [ ] Clip writes on a plays-only game are refused with 409 `plays_only`
- [ ] Sweep test: plays-only game reclaims normally at expiry
- [ ] Curated backend tests pass; CI green
