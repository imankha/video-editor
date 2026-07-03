# T4170: profile_db v019 — Heal Sweep Stream-Copy Reel Metadata (aspect_ratio + names)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-01
**Updated:** 2026-07-01

## Problem

The expiry-sweep auto-export published raw 1920x1080 stream-copy reels with **wrong metadata**
(root cause fixed in companion T4160; investigation memory `project_rank_raw_clips_sweep_bug.md`).
Live bad rows on prod (sarkarati@gmail.com, profile 806fb6aa) — 7 `final_videos` rows with
`filename LIKE 'auto_...'`:

| fv id | name | filename | ar (stored) | actual file |
|-------|------|----------|-------------|-------------|
| 16 | Amazing volley assist to LilaW | auto_6_62_46244cd1.mp4 | 9:16 | 1920x1080 (16:9) |
| 17 | Poached it in off the corner | auto_6_76_a0400da4.mp4 | 9:16 | 16:9 |
| 18 | Romy takes on 4 FRAM players | auto_1_3_131e04be.mp4 | 9:16 | 16:9 |
| 19 | Brilliant Tackle, Dribble... | auto_3_4_39ce36b2.mp4 | 9:16 | 16:9 |
| 20 | **Clip 5** | auto_3_5_762db662.mp4 | 9:16 | 16:9 |
| 21 | Lila throw in to Romy for goal | auto_4_26_4ed1a82b.mp4 | 9:16 | 16:9 |
| 22 | Romy to Kiana to Lila for the goal | auto_4_29_ba6e353e.mp4 | 9:16 | 16:9 |

Effect: raw 16:9 full-field footage is served in the **9:16 ranking game** ("Which is better?") and
9:16 collections. fv 20 additionally still carries the `Clip 5` fallback name (source raw_clip 5 is
unnamed; tags = Dribble/Control/Goal -> derivable). fv 5 (framed) and fv 20 (raw) share
`source_clip_id=5` — after the ar flip they become legitimate ratio twins under the twin-sync model.

## Solution

New versioned migration `src/backend/app/migrations/profile_db/v019_heal_sweep_reel_metadata.py`
(next free version after v018 — verify at implementation time, never reuse; see
`docs/...` + memory `reference_running_migrations.md`). **Generic predicate, all users** (any
profile DB may have sweep artifacts; eticatch's was 'skipped', others may exist):

1. `aspect_ratio` fix: rows where `source_type='brilliant_clip'` AND
   `filename LIKE 'auto\_%' ESCAPE '\'` AND `aspect_ratio='9:16'` -> set `aspect_ratio='16:9'`.
   The `auto_*` filename prefix is written ONLY by the stream-copy path
   (`auto_export._export_brilliant_clip`: `f"auto_{game_id}_{clip['id']}_{uuid}.mp4"`), and stream
   copies are always source-video ratio (16:9 game footage). No R2/ffprobe needed.
2. Name derivation: among those rows, where `name` matches `^Clip \d+$` (or is NULL/empty), derive
   via `derive_clip_name(raw_clip.name, raw_clip.rating or 0, decode_data(raw_clip.tags) or [],
   raw_clip.notes or '')` from the row's `source_clip_id`; keep the existing name when underivable
   or when the source clip row is gone. Do NOT touch user-renamed rows (anything not matching the
   fallback pattern).

No schema change — data-only heal, so `_SCHEMA_DDL`/`ensure_database` are untouched; only
`PRAGMA user_version` advances via the runner.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/profile_db/v019_heal_sweep_reel_metadata.py` — NEW
- `src/backend/app/migrations/profile_db/v018_heal_lost_publish_proj41.py` — pattern reference (targeted heal, guards, idempotency)
- `src/backend/app/migrations/profile_db/v012_flip_inverted_clip_ranges.py` — pattern reference (generic data fix)
- `src/backend/app/queries.py` — `derive_clip_name` (reuse)
- `src/backend/app/utils/encoding.py` — `decode_data` for the tags msgpack blob
- `src/backend/tests/` — migration test WITH DATA (not just empty-DB no-op)

### Related Tasks
- Companion: T4160 (code fix in auto_export.py) — disjoint files, parallel-safe. Deploy both, then run migrations.
- Pattern precedents: v017/v018 heals; v017 rowfactory bug (memory `project_v017_migration_rowfactory_bug.md`)

### Technical Notes (gotchas — all bitten before)
- **Migration runner hands `up(conn)` a TUPLE row factory**, not sqlite3.Row — index rows
  positionally (`r[0]`, `r[1]`), never `r['col']`. v017 crashed on prod for 4 users exactly here.
  Test the row-reading path with real rows.
- `LIKE 'auto_%'`: `_` is a LIKE wildcard — use `ESCAPE '\'` with `auto\_%` so `automatic...` names
  can't match.
- Idempotent: re-run must find nothing (both UPDATEs are self-neutralizing; runner also gates on
  user_version).
- Migrations do NOT auto-run on deploy. After deploy run per env:
  `POST /api/admin/migrate` (admin session) or the fly ssh one-liner in CLAUDE.md. The runner
  applies to every user's R2 profile DB.
- Guard for missing tables on fresh/empty profile DBs (v018 pattern).
- Twin-sync side effect is intended: fv 20 moving to 16:9 makes it fv 5's ratio twin
  (shared source_clip_id rating updates already hit both).

## Implementation

### Steps
1. [ ] Branch `feature/T4170-heal-sweep-reel-metadata`
2. [ ] Confirm v019 is the next free profile_db version (grep migrations dir; check staging/prod current user_version)
3. [ ] Failing test first: seed a profile DB with an `auto_*` 9:16 row named `Clip 5` (+ source raw_clip with tags) and a user-renamed `auto_*` row -> migration flips ar on both, renames only the `Clip 5` one; second run is a no-op
4. [ ] Write v019 (tuple row factory!), register in migrations/__init__ if needed
5. [ ] Backend tests green; import check

## Acceptance Criteria

- [ ] All `auto_*` brilliant_clip rows carry `aspect_ratio='16:9'` after migration
- [ ] Fallback-named (`Clip {n}`) sweep rows get derived names where derivable; user renames untouched
- [ ] Idempotent re-run; empty/fresh DB no-op
- [ ] Migration run on dev/staging/prod after deploy (admin endpoint), verified on sarkarati prod rows
