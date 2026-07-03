# T4160: Sweep Auto-Export Must Not Publish Raw Stream-Copies Over Framed Reels

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-07-01
**Updated:** 2026-07-01

**DEADLINE: must be deployed before 2026-07-09** (imankh prod game 6 storage expiry; game 7 follows 2026-07-11).

## Problem

The game-expiry sweep's brilliant-clip auto-export (`_export_brilliant_clip` in
`src/backend/app/services/auto_export.py`) publishes raw, unframed video into the user's reels and
the 9:16 ranking pool. **Proven on prod** (sarkarati@gmail.com, profile 806fb6aa: 7 `auto_*`
final_videos rows, ffprobed 1920x1080, `aspect_ratio='9:16'`, match_counts 5-10 — served and voted
on in the ranking game; one row still named `Clip 5`). Root-cause investigation 2026-07-01; see
memory `project_rank_raw_clips_sweep_bug.md`.

Three defects in `_export_brilliant_clip`:

1. **Destroys framed reels (the July 9 time bomb).** The replace query
   (`SELECT id, filename FROM final_videos WHERE source_type='brilliant_clip' AND project_id = ?`)
   finds the user's existing framed, published, match-played reel for the auto project, then the
   INSERT+DELETE swap replaces it with an unframed 1920x1080 ffmpeg stream-copy and a **freshly
   seeded rating** (match history lost). imankh's prod game 6 has ~20 unnamed 5-star clips whose
   auto projects have framed published reels (fv ids incl. 28-36 range) — all get replaced when
   game 6 expires 2026-07-09.
2. **Wrong aspect_ratio.** Stamped from `projects.aspect_ratio` of the auto project (`'9:16'`)
   while the artifact is a stream-copy at source resolution (16:9). This is what routes raw
   full-field footage into the 9:16 ranking pool (`rank.py _rankable_pool` filters on
   `fv.aspect_ratio`).
3. **Wrong name.** `clip['name'] or f"Clip {clip['id']}"` (auto_export.py:190) bypasses
   `derive_clip_name`, so unnamed clips publish as "Clip 5"/"Clip 16" — unlike every other naming
   path (cf. `derive_project_name` in `services/export_helpers.py`, `derive_clip_name` in
   `queries.py`). Violates the frozen-explicit-names rule.

Also: publishing a stream-copy for a clip that ALREADY has a published framed reel from a custom
project creates a duplicate contestant (sarkarati fv 5 framed vs fv 20 raw, same
`source_clip_id=5`). The pool dedup (rank.py) hides one, but both rows twin-sync ratings.

## Solution

In `_export_brilliant_clip`:

1. **Skip entirely when a framed reel already exists.** Before exporting, check for any published
   `final_videos` row with the same `source_clip_id` (covers both the auto project's own export and
   custom-project exports of the same clip). If one exists, log and return — the highlight is
   already preserved in framed form. Do NOT delete or replace anything.
2. **Stamp the real aspect_ratio.** Derive from the actual output file (ffprobe width/height ->
   `'16:9'` / `'9:16'` mapping, same convention as elsewhere), NOT from the auto project. A
   stream-copy of a game video is 16:9.
3. **Derive the name.** Use the same chain as `derive_project_name`:
   `derive_clip_name(clip['name'], clip['rating'] or 0, tags, clip['notes'] or '') or f"Clip {clip['id']}"`.
   (tags come from `decode_data(clip['tags'])`; extend `_get_annotated_clips` if a column is
   missing from its SELECT — it already selects tags/notes.)

Decision note: raw extracts that DO still get created (no framed reel exists) stay in the ranking
pool but under their honest `16:9` ratio. Rejected alternative — `rating=NULL` to keep them out of
the pool — because rank endpoints treat a published single-clip reel without a rating as a
seed/backfill bug and 400 on it.

Companion task T4170 heals the rows already on prod. The two tasks touch disjoint files.

Also correct the motivating story in `docs/plans/tasks/T4150-pwa-in-session-update.md` (its
"stale PWA bundle caused the raw-clips sighting" claim is disproven — the sighting was this bug on
the sarkarati account; T4150 remains valid as PWA-update hardening).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/auto_export.py` — `_export_brilliant_clip`, `_get_annotated_clips` (the fix)
- `src/backend/app/queries.py` — `derive_clip_name` (reuse, no change expected)
- `src/backend/app/services/export_helpers.py` — `derive_project_name` (reference pattern)
- `src/backend/app/routers/rank.py` — `_rankable_pool` (reference: why aspect_ratio matters; no change expected)
- `src/backend/tests/` — new/updated tests for auto_export
- `docs/plans/tasks/T4150-pwa-in-session-update.md` — correct the Problem section (docs-only)

### Related Tasks
- Companion: T4170 (v019 heal migration for existing bad rows) — parallel-safe, disjoint files
- Related history: T4010 (atomic re-export swap — the replace logic being neutered here was
  hardened there; keep its post-commit R2 cleanup pattern for any path that still replaces),
  T3630 (ranking pool semantics), bug22 (teammate exclusion — sweep still exports teammate
  `my_athlete=0` clips; their reels are pool-excluded via the clause, leave as-is)

### Technical Notes
- The sweep runs headless (`sweep_scheduler.py` -> `auto_export_game`), sets ContextVars itself,
  and syncs to R2 explicitly — keep `sync_db_to_r2_explicit` behavior intact.
- `games.auto_export_attempts` caps retries at 3; a skip-because-framed-reel-exists must count as
  success for that clip, not a failure.
- Recap generation (`_generate_recap`) is untouched.
- Test the row-reading paths with data (sqlite3.Row here, but see memory
  `reference_migration_runner_rowfactory.md` for the migration-side gotcha — applies to T4170).

## Implementation

### Steps
1. [ ] Branch `feature/T4160-sweep-auto-export-preserve-framed-reels`
2. [ ] Failing tests first: (a) existing published framed reel w/ same source_clip_id -> sweep
       skips, framed row untouched; (b) no existing reel -> stream-copy row created with
       aspect_ratio from file dims and derived name; (c) unnamed+untagged clip -> falls back to
       `Clip {id}` (documented last resort)
3. [ ] Implement the three fixes in `_export_brilliant_clip`
4. [ ] Correct T4150 task file Problem section
5. [ ] Backend tests green; import check (`python -c "from app.main import app"`)

## Acceptance Criteria

- [ ] Sweep never deletes/replaces a published final_videos row that has framed content
- [ ] New stream-copy rows carry the actual file's aspect ratio
- [ ] New stream-copy rows get derived names (Clip {id} only when underivable)
- [ ] Deployed to prod before 2026-07-09
