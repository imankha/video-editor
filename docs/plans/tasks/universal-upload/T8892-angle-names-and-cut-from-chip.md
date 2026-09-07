# T8892: T8890 follow-ups - real angle names + the "cut from {angle}" chip

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-06
**Updated:** 2026-09-06

## Problem

Two defects found 2026-09-06 by driving T8890 (PR #356) on a local stack with a real
overlap game seeded through the real upload path (recipe below). Everything else in
T8890 verified end-to-end: bar geometry, click-to-switch with exact time mapping
(game 217.58 s -> sideline file time 97.58 s = the 120 s offset), auto-fallback with no
black frame, clip saved with `video_sequence = 2` and correct file-relative times.

**1. Every angle is labelled with its blake3 hash.** The angle bar, the switcher badge,
the sidebar pill and the tooltip all read `67ef5ee…423a69`. Root cause:
`buildGameTimeline` names angles via `filenameStem(v.url)`
(`modes/annotate/hooks/useVirtualTimeline.js` ~L330 + ~L616), and `v.url` is the R2
storage URL, which is content-addressed (`games/{blake3}.mp4`). The original filename is
never stored in `game_videos` at all. The spec'd `Extra clip {n}` fallback can never
fire because the stem is never empty. Unit tests passed because they fed synthetic
human-readable URLs. With two angles a user sees two hashes and cannot tell the cameras
apart - this guts the feature's core interaction.

**2. The "cut from {angle}" chip was never built.** T8890's Technical Notes require:
while the active source is not the backbone, the Add/Edit Play strip header appends a
violet chip `from {angle}` plus the microcopy "This play will be cut from {angle}."
`grep -rn "will be cut from" src/frontend/src` finds nothing. The worker's acceptance
map covered the sidebar pill and the save wiring and silently skipped this. Today,
while cutting from an angle, nothing in the editor tells you which camera you are
cutting from.

## Solution

**Names, properly:** store the original filename with the video. New nullable column
`game_videos.original_filename` (profile_db migration **v052** - free as of 2026-09-06,
re-check unmerged siblings at implementation time per the migration-version-collision
memory), threaded from the picker (`file.name`, already on every intake item) through
the same hops T8870 used for `creationTime`, projected by the game-videos response, and
consumed by `buildGameTimeline` for the angle name: stem of `original_filename`,
middle-ellipsis to 14 chars, else `Extra clip {n}` by lane order. **Never derive a name
from the URL.** Legacy rows (no filename was ever stored) get the `Extra clip {n}`
fallback - that is the correct, honest label, not a defensive fixup.

**Chip:** implement the spec'd header chip + microcopy in the Add/Edit Play strip
(T8600's strip; header text "Adding new play" / "Editing play"), reading the same name
source. Also confirm "editing an angle clip auto-activates its source while the editor
is open" (spec'd in T8890) actually happens; add it if not.

See [EPIC.md](EPIC.md) decisions 8 (angle vocabulary/colour) and 10 (clip model).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` - `game_videos` DDL in `ensure_database()` (+ column)
- `src/backend/app/migrations/profile_db/v052_game_video_original_filename.py` - NEW;
  register in `migrations/profile_db/__init__.py`; bump `HEAD_VERSION_AUDITED` 51 -> 52
  in `tests/test_t6030_migration_window_structural_guard.py` (derive from the registry,
  never a literal - see the hardcoded-migration-head memory)
- `src/backend/app/routers/games.py` - `VideoReference` (+ `original_filename: str |
  None`), `_insert_game_videos`, `_get_game_videos_response`, `load`, `create_game`,
  `add_game_videos` (column_exists-guard the read per the T5630 window rule, exactly as
  T8870 did for `recorded_at`)
- `src/frontend/src/components/GameFootagePicker.jsx` - add `originalFilename: it.name`
  to the `onFootageChange` payload
- `src/frontend/src/containers/AnnotateContainer.jsx` (`handleGameVideoSelect`
  metadata), `src/frontend/src/stores/uploadStore.js`, `src/frontend/src/services/
  uploadManager.js` (`videoRef.original_filename` on create + attach) - mirror T8870's
  `creationTime` -> `recorded_at` threading hop for hop
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` - `buildGameTimeline`
  angle naming (~L616); delete the URL-derived path
- The Add/Edit Play strip component (find via the "Adding new play" header text; it is
  T8600's strip, rewritten in `ClipDetailsEditor.jsx` / `AnnotateFullscreenOverlay.jsx`
  per the T8600 memory - read the CURRENT files, do not trust older line refs) - chip +
  microcopy
- Tests: `useVirtualTimeline.overlap.test.js` (naming), `AnnotateTimeline.angleStrip.
  test.jsx`, `AngleSwitcherBadge.test.jsx`, `ClipListItem.anglePill.test.jsx` (fixtures
  currently rely on URL-derived names - update), `GameFootagePicker.test.jsx`,
  `uploadManager.test.js`, backend `tests/test_t8870_overlap_schema.py` (extend) or a
  new `test_t8892_original_filename.py`

### Related Tasks
- Depends on: T8890 (PR #356). **Merge #356 first** - it is verified working and CI green;
  these fixes are additive, and stacking a migration onto a 21-file PR breaks the
  "< ~200 lines per reviewable unit" rule. Branch from master after the merge.
- Depends on: T8872 (hotfix) being merged, so the seeding recipe below reflects the real
  rule - note that after T8872 the upload path sends `recorded_at` only at confidence
  `time`, so to seed an overlap game for THIS task's verification either (a) use the
  API directly with explicit `recorded_at` values on `create_game`, or (b) temporarily
  test on a pre-T8872 checkout. (a) is the clean option and doubles as an API test.
- Blocks: T8900 (fix-timing shows the angle name in its A/B buttons), T8910 (add-footage
  toasts name the angle) - both need real names to be usable.
- Include the Migration agent (schema change). `pg.py` `_SCHEMA_DDL` is NOT involved
  (`game_videos` is profile_db only - grep to confirm, note it in the status).
- Read `.claude/knowledge/annotate.md` (T8880 + T8890 sections) and
  `.claude/knowledge/persistence-sync.md` (migration conventions) FIRST.

### Technical Notes
- `original_filename TEXT NULL` - stored as the user's filename with extension as given
  (`sideline.mp4`); the FRONTEND strips path/extension for display. Never user-edited,
  never recomputed. Migration is additive, idempotent, tuple-row-safe; no backfill is
  possible (the datum never existed) - do not fabricate one.
- Name derivation (frontend, single source of truth in `buildGameTimeline`):
  `original_filename` present -> stem (drop last extension) -> `middleEllipsis(stem, 14)`;
  absent -> `Extra clip {n}` where n is 1-based lane-order index among angles. Backbone
  name stays "Main camera". The bar, badge, pill, tooltip, chip, and T8900/T8910 all read
  `angle.name` - do not compute names anywhere else.
- Chip: violet family per EPIC decision 8 (`bg-violet-600 text-white` or the
  `border-violet-500/40 text-violet-300` variant to match `AngleLanes`), camera glyph,
  `from {angle.name}`; microcopy line "This play will be cut from {angle.name}." Render
  ONLY when `activeSourceSequence` is a non-backbone sequence; zero pixels otherwise
  (same equivalence bar as T8890 - angle-free games must render byte-identical).

## Implementation

### Steps
1. [ ] Migration v052 + DDL + registry + structural-guard head bump; DDL-equivalence
   test (fresh == migrated).
2. [ ] Backend: model field, insert, response projection (column-guarded), create/attach
   accept it; test that `create_game` with `original_filename` persists and returns it,
   and that a legacy row (NULL) round-trips as `null`.
3. [ ] Frontend threading: picker payload -> container -> uploadStore -> uploadManager
   (create + attach). Payload/unit tests at the picker and uploadManager boundaries.
4. [ ] `buildGameTimeline` naming from `original_filename` with the `Extra clip {n}`
   fallback; remove `filenameStem(url)` from naming; update the fixtures in the four
   T8890 test files to pass `original_filename` and assert real names + fallback.
5. [ ] Add/Edit Play strip chip + microcopy; component test (active angle -> chip with the
   name; backbone -> nothing rendered). Verify/implement edit-auto-activates-source.
6. [ ] Live QA on the seeded overlap game (recipe below): bar/badge/pill/tooltip/chip all
   read `sideline`; an older game (no filename) shows `Extra clip 1`, never a hash.
7. [ ] Update `.claude/knowledge/annotate.md` (angle naming source of truth, the v052
   column) and `persistence-sync.md` (v052).

### Verification recipe (used 2026-09-06, works end-to-end)
```bash
# two visually unmistakable overlapping files with burned-in file-relative timers
cp /c/Windows/Fonts/arial.ttf ./arial.ttf
ffmpeg -y -f lavfi -i color=c=navy:s=854x480:d=480:r=30 \
  -vf "drawtext=fontfile=arial.ttf:text='MAIN CAMERA':fontsize=56:fontcolor=white:x=(w-text_w)/2:y=110,drawtext=fontfile=arial.ttf:text='file time %{pts\\:hms}':fontsize=44:fontcolor=yellow:x=(w-text_w)/2:y=230" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  -metadata creation_time="2026-09-06T14:00:00Z" main-camera.mp4
ffmpeg -y -f lavfi -i color=c=darkorange:s=854x480:d=180:r=30 \
  -vf "drawtext=fontfile=arial.ttf:text='SIDELINE PHONE':fontsize=56:fontcolor=black:x=(w-text_w)/2:y=110,drawtext=fontfile=arial.ttf:text='file time %{pts\\:hms}':fontsize=44:fontcolor=black:x=(w-text_w)/2:y=230" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  -metadata creation_time="2026-09-06T14:02:00Z" sideline.mp4
```
Overlap = game time 2:00-5:00. Expected placement: `offset_seconds` 0 and 120. Expected
mapping: at game time T inside the overlap, the sideline shows `file time T-120`.
Log in on the local stack via `POST /api/auth/dev-login {"email":"imankh@gmail.com"}`
(header `X-Test-Mode: true`). After T8872, seed via the create-game API with explicit
`recorded_at` (the picker will null them for overlapping files until T8824). A seeded
copy already exists in the dev profile as game "Vs ANGLE TEST Sep 6" (id 10) - reuse or
delete it.

### Progress Log

**2026-09-06**: Filed from the live local-stack verification of T8890.

## Acceptance Criteria

- [ ] Fresh and migrated DBs have identical schema (DDL-equivalence test); legacy rows
      read back `original_filename = null`
- [ ] A game uploaded with `sideline.mp4` shows `sideline` on the angle bar, switcher
      badge, sidebar pill, tooltip and the Add Play chip; a legacy overlap game shows
      `Extra clip 1`; no surface anywhere shows a hash (assert with a regex over the
      rendered angle UI in a component test)
- [ ] "This play will be cut from sideline." + violet `from sideline` chip render only
      while an angle is active; angle-free games render byte-identical (existing
      equivalence test still green)
- [ ] Curated backend + frontend sets green; Reviewer pass; live QA screenshots per
      criterion
