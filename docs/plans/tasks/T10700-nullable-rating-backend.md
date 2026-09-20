# T10700: Nullable rating — backend migration + compat (v054)

**Status:** TODO
**Impact:** 5
**Complexity:** 6
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

`raw_clips.rating` is `INTEGER NOT NULL`, so a play can never truly have "no rating" — every
Annotate play gets a real value the moment it's created. T10690 (approved design,
`docs/plans/tasks/T10690-design.md`) makes rating nullable so the Annotate rated badge can show
a genuine unset state instead of always reading DONE. This task is the backend half only:
migration + model/query changes that are **fully backward compatible** — an old frontend client
that still sends a rating on every create keeps working exactly as today. T10710 (frontend, blocked
by this task) is what actually stops seeding a default and adds the unset badge.

**Ship order matters** (design doc § 5 R1): this task must land and be verified on staging BEFORE
T10710 starts, or the frontend's stopped-seeding-a-rating change 500s every Mark-play tap against
a still-`NOT NULL` column.

## Solution

Read `docs/plans/tasks/T10690-design.md` §§ 3.A, 4, 5, 6 (the open questions, already ruled — see
Decisions Locked below) and § E for the full file-by-file/line-numbered plan; this file summarizes
it into an actionable checklist. Do not re-derive the plan from scratch — the design doc is the
source of truth for exact line numbers and pseudocode.

### Decisions locked (from T10690's approved decision artifact — do not re-open)
- **C1 (badge visual):** N/A to this task (frontend, T10710) — noted here only so the backend
  doesn't need to carry any badge-state concept.
- **C2 (clear rating back to unset):** **NO.** Do not touch `clips.py:1499`'s
  `if update.rating is not None:` guard — `RawClipUpdate.rating` keeps meaning "absent" for `None`.
- **D (unrated derived name):** drop the adjective (`derive_clip_name` returns tag-only text, no
  "Interesting"/"Brilliant" prefix, when `rating is None`).
- **B11 (TSV round-trip):** **deferred**, out of scope for this task — this is a frontend-side item
  anyway (`useAnnotate.js`), so it lands with T10710 if picked up at all, not here.
- **ShareGameModal chip:** frontend, T10710's concern.

### A.1 — Migration `v054_raw_clips_rating_nullable.py` (profile_db track)
Full spec: design doc § 3.A.1 (hazard table + pseudocode `up(conn)` sequence). Key points:
- **Re-check `src/backend/app/migrations/profile_db/` for an unmerged sibling claiming v054**
  before naming the file (known recurring landmine — `project_migration_version_collision_across_branches`
  memory / `.claude/knowledge/persistence-sync.md`).
- SQLite can't `ALTER COLUMN DROP NOT NULL` — this is a full rebuild-and-copy (12-step procedure),
  the FIRST such rebuild in `profile_db/` (every prior migration there is ADD/DROP COLUMN only).
- **Must force `PRAGMA foreign_keys=OFF`** around the rebuild regardless of the caller's setting —
  `database.py:1753` and `materialization.py:63` both open with `foreign_keys=ON`, and a
  `DROP TABLE raw_clips` under FK-ON cascade-deletes `working_clips`/`modal_tasks`/`clip_teammates`.
  Commit any open transaction before toggling the pragma (it's a no-op inside one), then
  `BEGIN IMMEDIATE` for the rebuild itself.
- Capture and replay the 3 indexes (`idx_raw_clips_game_id`, `idx_raw_clips_rating`, unique
  `idx_raw_clips_game_end_time_seq`) from `sqlite_master` before dropping the old table.
- Capture and restore `sqlite_sequence.seq` for `raw_clips` (`MAX(old, new)`) — otherwise a
  deleted-then-recreated id gets reused and silently re-points a published reel's frozen
  `final_videos.source_clip_id` (T3630) at the wrong play.
- Guard: no-op if the table is missing (minimal test fixture) or already nullable (safe re-run
  after a crash between this migration's commit and the runner stamping `user_version`).
- `PRAGMA foreign_key_check` before the final commit; raise+rollback on any row.
- Also update `database.py:1182` (`rating INTEGER NOT NULL` → `rating INTEGER`) so fresh DBs get
  the head shape directly and skip the migration.
- Dedicated test `tests/test_t10690_migration_v054.py` (precedent: `test_t4330_migration_v044.py`):
  build a v053-shaped DB with rated clips + child `working_clips`/`clip_teammates` rows, run v054,
  assert: rating accepts NULL; every raw clip AND every child row survived; all 3 indexes exist;
  `sqlite_sequence` didn't go backwards; re-running is a no-op; `foreign_key_check` is clean.

### A.2 — `clips.py` request/response models (design doc § 3.A.2 has the full table)
- `RawClipResponse.rating` (line ~135): `int` → **`int | None`** (mandatory — otherwise Pydantic
  500s the clip list on any NULL row).
- `RawClipCreate.rating` (line ~162): `int = 3` → **`int | None = None`**.
- `RawClipUpdate.rating` (line ~174): **unchanged** (C2 = no clear).
- Bulk import `ClipUploadItem`/`or 5` default (line ~2152) and video-upload `Form(3)` default
  (line ~2200): **unchanged** — neither flow has an unrated affordance in the UI, so keep seeding
  those two as today. This confines the new NULL domain to annotate-created plays only.
- `list_raw_clips(min_rating)` / `AND rating >= ?` (line ~892/916-918): unchanged behavior (SQL
  `NULL >= n` is NULL, correctly excluding unrated clips from any real filter) — add a comment.

### A.3 — Delete `normalize_rating` / `UNRATED_RATING` (`queries.py:16-38`)
Its contract ("NULL is a bug, log ERROR, substitute 3") is exactly the repealed rule. Three
callers, each gets different explicit treatment (design doc § 3.A.3):
- `clips.py:~1090` (auto-project name) → pass the raw (possibly `None`) rating into
  `derive_clip_name` directly.
- `clips.py:~1752` (`clip_list`) → pass the raw value through to the response.
- `games.py:~1355` (`game_stats` rating counts) → `if rating is None: continue` before the
  5/4/3-star ladder — **this is the exact bug the task exists to stop**: today an unrated play
  would get silently counted as a 3-star badge.

Update `tests/test_t4280_silent_fallbacks.py:142-151` — rewrite (don't delete)
`test_normalize_rating_single_semantics` for the new rule: the three call sites above return/count
`None` rather than substituting 3.

### A.4 — `derive_clip_name` (`queries.py:41-87`) — no adjective when unrated
```
if rating is None: return tag_part   # no invented "Interesting"/"Brilliant"
return f"{get_rating_adjective(rating)} {tag_part}"
```
Callers that pre-coerce (`projects.py:299,779,1594` — `rating or 0`/`or 3`) must stop coercing and
pass the raw value, or this branch is unreachable.

**Do NOT touch the frontend twin** `clipDisplayName.js`'s `generateClipName` here — that's T10710's
job (frontend PR), but the backend and frontend behavior must match once both ship, so read design
doc § 3.A.4 now so the two implementations agree exactly.

### A.5 — Clip-picker filter (`projects.py:715-735` `_build_clips_filter_query`)
`WHERE COALESCE(rc.rating, 0) >= ?` with default `min_rating = 1` would make every unrated clip
invisible in multi-clip pickers (`GameClipSelectorModal`, `ClipLibraryModal`) once NULLs exist.
Change the "unfiltered" guard from `min_rating <= 0` to `min_rating <= 1` — "1+" has never excluded
a rated clip, so this is safe and doesn't change filtering for any existing (rated) clip.

### A.6 — Other backend touch points (design doc § 3.A.6 has the full table)
- `clips.py:~1303-1326` (`save_raw_clip` retry branch): `SET rating = ?` → `rating = COALESCE(?, rating)`
  — otherwise a retried create with an absent rating NULLs a rating set in between.
- `materialization.py:680` `clip.get("rating", 3)` → `clip.get("rating")` (the `, 3` is already
  ineffective when the key exists with `None`; this is honesty, not a behavior change).
- `games.py:2457` + `games.py:199-215` `generate_clip_name`/`get_rating_adjective` call: same
  null-check as A.4.
- `constants.get_rating_adjective`/`get_rating_notation`/`get_rating_color_*`: **unchanged**, stay
  1-5 lookups. Callers branch on `None` before calling — do not teach the lookup tables about NULL.

## Context

### Relevant Files
- `src/backend/app/database.py` — `raw_clips` DDL (~1178-1200), `ensure_database`
- `src/backend/app/migrations/profile_db/` — existing migrations (ADD/DROP COLUMN precedent), `__init__.py` registration
- `src/backend/app/routers/clips.py` — models + the call sites listed above
- `src/backend/app/queries.py` — `derive_clip_name`, `normalize_rating`, `UNRATED_RATING`
- `src/backend/app/routers/projects.py` — `_build_clips_filter_query`, the three `rating or ...` pre-coercions
- `src/backend/app/routers/games.py` — `game_stats` rating counts, `generate_clip_name` call
- `src/backend/app/services/materialization.py` — `clip.get("rating", 3)`
- `src/backend/app/constants.py` — rating lookup tables (unchanged, read-only reference)
- `src/backend/tests/test_t4280_silent_fallbacks.py`, `test_clips.py` — tests to update/add

### Knowledge docs
- `.claude/knowledge/annotate.md`, `.claude/knowledge/persistence-sync.md` §§ migration mechanics
- `.claude/references/coding-standards.md` § "Correct data, not workarounds" — **this is explicitly
  NOT that pattern**: no existing data is wrong, this widens a valid domain. Say so in the migration
  docstring.

### Related Tasks
- Design: T10690 (DECIDED, approved 2026-09-19)
- Blocks: T10710 (frontend — stop seeding a default, unset badge, display sites). **Must merge and
  be verified live on staging before T10710 starts.**

### Technical Notes
- This PR changes NO frontend-visible behavior by itself — every existing client still sends a
  rating on create, so `rating` stays non-null for every clip created through today's flow. It only
  makes the column and models *capable* of holding NULL.
- Migration agent should write v054; classification includes it (schema change).
- Needs the Migration agent (schema change), Tester Phase 1 (test-first on the migration + the
  three `normalize_rating` call sites), Reviewer (Tier L schema change).

## Implementation

### Steps
1. [ ] Load knowledge docs; re-check `migrations/profile_db/` for a v054 collision
2. [ ] Migration agent: write `v054_raw_clips_rating_nullable.py` + register it + update `database.py` DDL + `tests/test_t10690_migration_v054.py`
3. [ ] Tester Phase 1: failing tests for A.2-A.6 (nullable models, deleted `normalize_rating` callers, filter fix, COALESCE retry fix)
4. [ ] Implement A.2-A.6
5. [ ] Reviewer fan-out (schema change, Tier L)
6. [ ] Tests green, merge, verify on staging (a profile migrates JIT on next access — confirm via a real dev-login + clip create/list/update round trip)
7. [ ] Status -> STAGING; tell the user staging is verified before T10710 starts

### Progress Log

**2026-09-19**: Filed from the approved T10690 design. Not started.

## Acceptance Criteria

- [ ] `raw_clips.rating` accepts NULL on both fresh DBs and migrated ones; migration test passes all 6 assertions (§ A.1)
- [ ] No existing `working_clips`/`modal_tasks`/`clip_teammates` rows are lost by the migration (FK cascade trap covered by test)
- [ ] `sqlite_sequence` never regresses across the migration
- [ ] An old-style create (rating always sent) behaves byte-identical to today
- [ ] A create/update with no rating field stores NULL and round-trips as `rating: null` in the API
- [ ] `normalize_rating`/`UNRATED_RATING` deleted; the three former callers have explicit, different treatments (not one shared coercer)
- [ ] `min_rating <= 1` no longer excludes an unrated clip from clip pickers
- [ ] A retried create does not clobber a rating set in between (`COALESCE`)
- [ ] Reviewer findings addressed; CI green on staging
