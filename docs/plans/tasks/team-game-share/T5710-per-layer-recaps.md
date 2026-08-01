# T5710: Per-layer recaps (Team Recap / {Athlete} Recap)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-21
**Updated:** 2026-07-21

Task 2 of 5 in the [Share the Game epic](EPIC.md).

## Problem

The recap is one mixed cut of ALL rated clips (`_get_annotated_clips` has no layer predicate),
so there's no "team recap" to hand the team chat and no clean "{Athlete} recap" for the family.
Per [EPIC.md](EPIC.md) decision 5, the combined recap is REPLACED by two per-layer recaps.

## Solution

1. **Layer-filtered clip selection** — `_get_annotated_clips(conn, game_id, layer)` in
   `auto_export.py:138` gains a layer filter: athlete = `(my_athlete = 1 OR my_athlete IS NULL)`,
   team = `my_athlete = 0`. (Team layer includes imported clips — a team recap should show the
   whole team's plays regardless of who annotated them.)
2. **Per-layer stitched recaps** — `_generate_recap` produces per-layer outputs:
   - Athlete recap keeps the existing key `recaps/{game_id}.mp4` (regenerated content;
     existing consumers keep working)
   - Team recap at `recaps/{game_id}_team.mp4`
   - Frozen clip mappings per layer (`recaps/{game_id}_clips.json` pattern →
     `_team` variant)
   - Skip stitching a layer with zero clips (no empty videos).
3. **`recap-data` layer param** — `GET /api/games/{id}/recap-data?layer=athlete|team`
   (`games.py:1095`): resolution order per layer (stitched recap → game-video seek-through with
   layer-filtered clip mapping → none post-grace). `_compute_recap_clips`/`_compute_game_clips`
   take the same layer filter.
4. **Recap viewer split** — `RecapPlayerModal.jsx`: the Annotations tab becomes two entries —
   **Team Recap** and **{Athlete} Recap** (athlete = active profile name). Same player, same
   clip rail, layer param on the data fetch. Per-player filter chips on the Team Recap
   (filter the clip rail by `tagged_teammates` — epic decision 7).
5. **On-demand stitch helper** — extract/ensure a callable `ensure_recap(game_id, layer)` that
   T5720's share-creation gesture can invoke (stitch-on-share, epic architecture decision 4).
   Poster per layer via the existing `ensure_recap_poster` machinery (T5180), team-poster key
   `recaps/posters/{game_id}_team.jpg`.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/auto_export.py` — `_get_annotated_clips` (L138),
  `_generate_recap` (L312), recap R2 keys + `games.recap_video_url` write (L121),
  `backfill_hiq_recaps` (L487)
- `src/backend/app/routers/games.py` — `recap-data` (L1095), `_try_load_recap_mapping`
  (L1027), `_compute_recap_clips` (L1040), `_compute_game_clips` (L1069)
- `src/backend/app/services/poster.py` — recap poster helpers (T5180 `ensure_recap_poster`)
- `src/frontend/src/components/RecapPlayerModal.jsx` — viewer split + player-filter chips
- Entry points opening the recap modal (game card recap button) — label/entry changes

### Related Tasks
- Depends on: T5700 (layer model visible in Annotate; the bit itself already exists)
- Blocks: T5720 (public link plays the team recap)
- Related: T4140 (hi-q recap re-edit source — keep `resolve_clip_source` semantics intact),
  T5180/T5270 (recap poster pipeline)

### Technical Notes
- Knowledge docs: [annotate.md](../../../.claude/knowledge/annotate.md),
  [export-pipeline.md](../../../.claude/knowledge/export-pipeline.md)
- `games.recap_video_url` currently stores the single recap ref — design the per-layer
  storage (two columns vs derived R2 keys). Prefer **derived keys** (deterministic
  `recaps/{game_id}.mp4` / `_team.mp4`, presence-checked) to avoid schema change; if a column
  is added anyway, include the Migration agent (profile_db track).
- Zero-team-clips games: recap viewer shows the Team Recap entry only when the layer has
  clips; `recap-data?layer=team` on an empty layer returns an explicit empty state, not an
  error and not a silent fallback to the other layer.
- Old combined recap files remain on R2 until regenerated — first regeneration per game
  replaces `recaps/{game_id}.mp4` with athlete-only content. No mass backfill required
  (regenerate lazily via the existing generation triggers + on-demand helper); decide in
  design whether stale mixed recaps in the viewer pre-regeneration are acceptable during
  rollout.
- Recap clips ARE raw_clips (T4130) — the clip-rail Create Clip flow must keep working on
  both layer views.

## Implementation

### Steps
1. [ ] Design pass: per-layer storage decision (derived keys vs column), rollout/staleness
       call, viewer entry design (light Architect gate)
2. [ ] Backend: layer filter through `_get_annotated_clips` → `_generate_recap` →
       `recap-data`; `ensure_recap(game_id, layer)` helper; per-layer posters
3. [ ] Frontend: RecapPlayerModal split (Team Recap / {Athlete} Recap) + per-player filter
       chips on the team view
4. [ ] Tests: layer filtering (incl. NULL-as-athlete + imported clips on team), empty-layer
       states, mapping offsets per layer
5. [ ] Real-browser verify on a game with clips on both layers

### Progress Log

**2026-07-21**: Created from the epic consolidation.

**2026-08-01**: Implementation complete (backend layer split, `ensure_recap`, frontend tab
split + player-tag filter chips); real-browser e2e verification surfaced and fixed 3 issues
in the verification harness itself (the player-tag filter was never broken):
1. e2e assertions checked clip-name text against the whole modal instead of the clip rail,
   so the currently-playing clip's name (legitimately rendered in the NotesOverlay overlay +
   PlaybackControls transport label, independent of the rail's player-tag filter) produced a
   false failure. Added `data-testid="recap-clip-rail"` to the rail container and scoped the
   e2e's existence/absence assertions to it.
2. Found a real test-isolation bug while chasing a follow-on failure: `seedRecapGame`/
   `cleanupTestUser` used Playwright's bare `request` fixture (no shared cookies), while
   `/api/auth/test-login` always resolves to the fixed shared `e2e@test.local` account
   regardless of `X-User-ID` — so seeded data landed in an orphaned namespace the
   cookie-authenticated browser never saw, and the UI opened a coincidental stale leftover
   game instead. Fixed by switching both calls to `page.request`. Same latent pattern likely
   exists in ~10 other specs (`collections.spec.js`, `T5330-share-signup-nuf.spec.js`, etc.) —
   out of scope here, noted in export-pipeline.md for a future sweep.
3. Seeded clips were 1s each; real autoplay drifted onto the next clip during the test's
   multi-step assertions, racing Create Clip's target. Bumped to an 8s-per-clip constant
   (`CLIP_SECONDS`) in the `seed-recap-game` test seam.

e2e (`T5710-per-layer-recap.spec.js`) passes clean end-to-end (all 6 criterion evidence
screenshots saved); backend `test_t5710_per_layer_recaps.py` + `test_auto_export.py` +
`test_t3970_expired_share_block.py` (72 tests) and `RecapPlayerModal.test.jsx` (37 tests) all
pass. Reviewer ran on the final diff: 0 blocking, 0 major findings, approved. Knowledge docs
(`export-pipeline.md`, `annotate.md`) updated with the per-layer architecture, the seed seam,
and the rail-vs-playback-overlay distinction.

## Acceptance Criteria

- [ ] Team Recap = team-layer clips (own + imported); {Athlete} Recap = athlete-layer clips
      (NULL treated as athlete); no combined recap remains in the UI
- [ ] Both recaps stitch + get posters; empty layers degrade explicitly (no fallback mixing)
- [ ] `recap-data?layer=` serves stitched or seek-through per layer, mapping offsets correct
- [ ] Team Recap clip rail filters by player tag
- [ ] `ensure_recap(game_id, layer)` callable exists for T5720's share gesture
- [ ] Create Clip from either recap view still works
