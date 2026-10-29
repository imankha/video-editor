# T13940: Sweep stitches missing recaps for expired games instead of keeping their refs forever

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-10-29
**Updated:** 2026-10-29


## Problem

Prod sweep logs (2026-10-29) show 24 expired refs that the expiry sweep refuses to reclaim on
every run: `[Sweep] hash=<12> recap artifacts MISSING - refusing reclaim, keeping ref to retry
next sweep`. The T10121 gate is right to refuse (reclaiming would delete a game source whose
recap does not exist), but nothing ever produces the missing recap, so the refs (and their
game videos in R2) are kept forever and, until T13920 lands, drive the sweep hot loop.

Why nothing produces it: the sweep only (re)exports games that `_find_games_for_hash` selects
(`auto_export_status` NULL, or failed/pending under the retry cap). A game whose status is
already `complete` (e.g. plays were added or a layer became non-empty after the export ran, or a
recap object was later removed) or `abandoned` is never selected again, and `auto_export_game`
short-circuits on `complete`. `recap_artifacts_present` then reports MISSING on every sweep.

## Solution (user decision 2026-10-29: "just create the recap videos if they are missing")

In the sweep's `KEEP_ARTIFACTS_MISSING` path, **build the missing recap instead of only
waiting**: for each game on the hash, for each layer (`RecapLayer.TEAM`, `RecapLayer.ATHLETE`)
that has marked plays but no recap object, call the existing idempotent
`ensure_recap(user_id, profile_id, game_id, layer)` (`services/auto_export.py`). It is a HEAD
on a hit, `'empty'` for a layer with no plays, and `'stitched'` from the still-present game
source on a miss. Then re-run `recap_artifacts_present`; if it is now PRESENT, continue down the
normal reclaim path (delete_ref -> 14-day grace -> Phase 2 delete). The source video still
exists for all 24 (that is exactly what the kept ref guarantees), so the stitch has its input.

Rules:
- No manual prod data edits. This is the sweep's normal product path; the recaps land where the
  app expects them and the user's profile DB syncs through the existing write path.
- Failures are loud and bounded: an `ensure_recap` exception logs ERROR with user/game/layer and
  the ref stays kept (T10121 safety unchanged). With T13920 the retry is hourly, not every 60s.
- `abandoned` games are included (they were abandoned because the recap was missing; a
  successful stitch resolves exactly that). Do not change `auto_export_attempts` semantics.
- Phase 2's `_phase2_artifact_gate_missing` keeps refusing deletes while anything is still
  missing; it does not need to stitch (Phase 1 does).
- Log one line per stitch (`[Sweep] stitched missing recap game=<id> layer=<layer>`) so the prod
  outcome is countable.

Evidence the worker records (read-only, no decision gate needed): from prod logs after deploy,
how many of the 24 healed and, for any that did not, the exception (that becomes its own task).

## Context

### Relevant Files
- `src/backend/app/services/sweep_scheduler.py` - KEEP_ARTIFACTS_MISSING branch in `do_sweep`, `_reclaim_verdict`, `_abandon_if_exhausted`
- `src/backend/app/services/auto_export.py` - `ensure_recap`, `recap_artifacts_present`, `auto_export_game`
- `src/backend/tests/` - existing sweep + auto_export tests (grep `KEEP_ARTIFACTS_MISSING`, `ensure_recap`)

### Knowledge Docs
- `.claude/knowledge/annotate.md` (recap), `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/backend-services.md`

### Related Tasks
- T13920 (sweep hot loop; same group, lands first)
- T10121 (the artifact gate), T5710 (per-layer recaps, `ensure_recap`)

## Acceptance Criteria

- [x] Test (red on master): an expired ref whose game is `complete` with a missing athlete (or team) recap gets that recap stitched by the sweep and the ref is reclaimed in the same run.
- [x] Test: same for an `abandoned` game.
- [x] Test: `ensure_recap` raising keeps the ref, logs ERROR, and does not crash the sweep.
- [x] Test: a layer with zero plays is never stitched (stays the legitimate empty case).
- [x] Existing T10121 sweep tests stay green.
- [x] Ruff clean on touched files.
- [ ] Post-deploy (Progress Log): count of `stitched missing recap` lines on prod and kept-for-missing refs drops from 24 to 0, or each remaining one is explained with its error.

## Progress Log

**2026-10-29**: Filed from the Cloudflare billing-alert investigation (see T13920).
**2026-10-29**: Re-scoped per user: stitch missing recaps via `ensure_recap` in the sweep instead of an investigation + manual repair.
**2026-10-29**: Implemented: `auto_export.missing_recap_layers` (per-layer detail behind `recap_artifacts_present`) + `sweep_scheduler._stitch_missing_recaps` in the KEEP_ARTIFACTS_MISSING branch; a healed game is written `complete` (athlete stitch also sets `recap_video_url`), synced, then the gate re-runs. Post-deploy prod count still pending.
