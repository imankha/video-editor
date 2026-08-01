# T5710 Design — Per-layer recaps: staleness & `ensure_recap`

**Scope of this doc:** the ONE open decision (stale pre-T5710 mixed recaps during rollout) + the
`recap-data?layer=` resolution order + the `ensure_recap` signature/idempotency contract. Everything
else (storage = derived keys, layer predicate, empty-state, labels) is locked in the kickoff/EPIC and
is NOT re-litigated here.

## Locked context (not decided here)

- Athlete recap = existing keys `recaps/{game_id}.mp4` + `recaps/{game_id}_clips.json`;
  `games.recap_video_url` keeps pointing at the `.mp4`.
- Team recap = sibling keys `recaps/{game_id}_team.mp4` + `recaps/{game_id}_team_clips.json` +
  poster `recaps/posters/{game_id}_team.jpg`. Presence-checked, no DB column, no migration.
- Layer predicate in `_get_annotated_clips`: athlete = `(my_athlete = 1 OR my_athlete IS NULL)`;
  team = `my_athlete = 0` (includes imported `shared_by NOT NULL`).
- Empty layer → explicit empty state; never a silent fallback to the other layer.

## Decision 1 — how a stale (pre-T5710) recap is detected

**Stamp the layer into the frozen mapping, and make that stamp the single discriminator.** Today
`recaps/{game_id}_clips.json` is a bare JSON *list*. Wrap it:

```json
{ "schema": "recap-map/v2", "layer": "athlete", "clips": [ {id,name,rating,tags,notes,recap_start,recap_end}, ... ] }
```

Team mapping `recaps/{game_id}_team_clips.json` = same wrapper, `"layer": "team"`. All readers of a
`_clips.json` go through ONE shared loader `load_recap_mapping(...) -> (layer, clips)`:
- dict with `layer` → `(layer, data["clips"])` — a fresh per-T5710 layer-pure recap.
- **bare list → `(None, list)` = pre-T5710 = MIXED** (contains both layers).

Back-compat consumers to update (must not regress): `_try_load_recap_mapping` (games.py) and
`_resolve_recap_source` (export_helpers / T4140 re-edit — landmine: keep matching entries by
`raw_clip id`, just unwrap first).

**No column, no migration** — the stamp lives in the artifact; absence of a stamp *is* the "legacy"
signal.

## Decision 2 — what happens on a stale hit (and post-expiry)

**Core rule: a legacy MIXED recap is never served as a stitched per-layer recap. It is only ever used
as a *seek source* with a layer-filtered rail** — the exact same mechanism already used for the game
video in the current `recap-data`. The player seeks only to the layer's clips inside the mixed mp4;
the rail lists only the layer's clips. No other-layer content is ever shown under a layer label, and
no clip is mislabeled. This holds even post-expiry, so the surviving mixed artifact keeps delivering
each family's own plays instead of being thrown away.

`recap-data` stays **READ-ONLY** — it never stitches on a GET (gesture-based-persistence rule).
Regeneration to a real per-layer recap happens only via `ensure_recap` on a gesture (auto-export,
T5720 share-create, or a future explicit "regenerate").

## Decision 3 — `recap-data?layer=athlete|team` resolution order (per layer)

Guard first: **layer has 0 clips → explicit empty state** (`video_kind=None`, `empty=true`), never
the other layer. Otherwise, first hit wins:

| # | Condition | Serve | `video_kind` |
|---|-----------|-------|--------------|
| 1 | Per-layer **stitched** recap present (mapping stamped for *this* layer) | that `.mp4`/`_team.mp4` + its frozen layer-pure mapping | `recap` |
| 2 | **Game video** present in R2 | game url + **live** layer-filtered game-relative mapping (`_compute_game_clips` + predicate) | `game` |
| 3 | **Legacy mixed** recap present (`recaps/{game_id}.mp4`, mapping unstamped), game gone | mixed url + mixed-mapping entries **filtered to the layer** (join `raw_clips.my_athlete` by entry `id`; offsets already recap-relative) | `recap_legacy` |
| 4 | none of the above | `url=None` + layer-filtered clip list (names only) | `null` |

For the **athlete** layer, rows 1 and 3 read the same key `recaps/{game_id}.mp4`; the mapping stamp
disambiguates (stamped=fresh row 1, unstamped=legacy row 3). For the **team** layer, legacy games have
no `_team.*`, so row 1 is skipped and row 3 filters the same mixed mp4 to team clips.

## Decision 4 — `ensure_recap` signature + idempotency

```python
def ensure_recap(user_id: str, profile_id: str, game_id: int, layer: str) -> EnsureRecapResult
# layer ∈ {"athlete","team"}  (str-Enum RecapLayer)
# EnsureRecapResult = {status: "present"|"stitched"|"empty",
#                      recap_key, mapping_key, poster_key, clip_count}
```

Idempotency contract (T5720 calls this synchronously before returning a share link):
1. **Hit path (cheap, no ffmpeg):** the layer's recap object exists AND its mapping is stamped for
   *this* layer (athlete: `recaps/{game_id}_clips.json.layer=="athlete"`; team: `_team_clips.json`
   present) → return `present`. A legacy MIXED `.mp4` counts as a **miss** for athlete (stamp absent),
   so first call replaces it with an athlete-pure recap.
2. **Empty:** layer has 0 clips → return `empty`; stitch nothing, write no empty video.
3. **Miss → stitch:** select layer clips, stitch from the best source — game video present → source
   extraction (existing `_generate_recap` path, native-res/T4140); game gone → **slice the layer's
   clips out of the legacy mixed recap** using the mixed mapping offsets (self-sufficient migration
   from the surviving artifact — never falls back to raw game source). Write `.mp4`/`_team.mp4` +
   stamped mapping, warm the layer poster, return `stitched`. Deterministic keys → re-stitch
   overwrites in place, safe under concurrent/repeat calls.

**T4140 preservation (both layers) — ordering invariant:** replacing the legacy mixed
`recaps/{game_id}.mp4` with an athlete-pure recap removes team clips' recap re-edit source. So a
full regen (auto-export, or `ensure_recap("athlete")` on a still-mixed game that has team clips)
**writes `_team.mp4` FIRST, then overwrites `.mp4` athlete-pure**, so no crash window orphans team
clips' `resolve_clip_source`. `_resolve_recap_source` must search BOTH recaps to re-materialize a
clip. `ensure_recap("team")` alone is purely additive (writes `_team.*`, never touches `.mp4`).

## What this satisfies

- No silent fallback showing one layer under the other's label (legacy mixed is seek-filtered, rail =
  layer clips only). ✔
- No mass backfill — lazy per-game regen via `ensure_recap` on existing gesture triggers. ✔
- No schema change / migration — stamp lives in the artifact; keys are derived. ✔
- T4140 re-edit-source preserved for BOTH layers via the write-order invariant. ✔

## Open questions for approval

1. **Row 3 (`recap_legacy`) worth building now, or defer to a plain empty/"regenerating" state?**
   Building it preserves expired legacy games' watchability from the only surviving artifact (my
   recommendation); deferring is less code but degrades old games to "no recap" per layer until a
   gesture regenerates (which post-expiry can only come from the mixed-slice path anyway).
2. **Mapping wrapper shape** — wrapper object `{layer, clips}` (recommended, single top-level stamp)
   vs. per-entry `layer` field (smaller reader change). Wrapper touches the T4140 `_resolve_recap_source`
   reader; both are back-compat via the shared loader.
3. **Should `ensure_recap("athlete")` eagerly co-generate the team recap** when the game still has a
   source (to keep both re-edit sources warm), or only generate the requested layer and rely on the
   write-order invariant? Recommend co-generate in the auto-export path (source present, cheap
   together) but single-layer for the on-demand T5720 call.

## Resolved (user approval, 2026-07-31)

1. **Q1 — build the `recap_legacy` seek-filtered path now (option A).** An expired game must stay
   watchable per layer. Refines row 3 of the resolution table:
   - Legacy mixed recap present **and its mapping resolves** (stamped-absent list whose clip `id`s
     still match live `raw_clips` rows, so `my_athlete` is known per entry) → seek-filtered to the
     layer, `video_kind='recap_legacy'`, rail = that layer's entries only, offsets from the mixed
     mapping (still valid — the mp4 itself didn't change).
   - Legacy mixed recap present but the mapping is **missing or its clip ids no longer resolve**
     (offsets unrecoverable, e.g. `raw_clips` rows deleted) → seeking is impossible. Degrade to a
     **single combined entry that plays the whole mixed file**, honestly labelled as the old combined
     recap (`video_kind='recap_legacy_combined'`, one rail row `{name: "Full game recap (pre-team-layer)"}`
     spanning the whole duration). This is an **explicit state presented under NEITHER per-layer
     label** — the UI must render it as its own banner/entry, never inside "Team Recap" or
     "{Athlete} Recap" chrome. Both layer requests resolve to the same combined entry in this case
     (there is nothing layer-specific left to show).
   - Row 4 (`none`) only when no artifact at all exists (no legacy mp4, no game video).
2. **Q2 — mapping stamp = wrapper object.** `{"schema": "recap-map/v2", "layer": "athlete"|"team", "clips": [...]}`,
   one shared loader (`load_recap_mapping`) used by every reader (`_try_load_recap_mapping`,
   `_resolve_recap_source`, `ensure_recap`'s hit-path check).
3. **Q3 — co-generation scoped to auto-export only.** `_generate_recap`'s auto-export caller stitches
   BOTH layers when the game source is open (write order: `_team.mp4` first, then athlete `.mp4`,
   per the T4140 invariant above). `ensure_recap(game_id, layer)` (T5720's on-demand call) stays
   **single-layer** — it does not co-generate the sibling.
