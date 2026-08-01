# T5725: Teammate tagging is Team-layer only

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-01
**Updated:** 2026-08-01

Inserted into the [Share the Game epic](EPIC.md) between T5720 and T5730, from user direction
2026-08-01 during T5720's design gate.

## Problem

Teammate tagging and the layer model contradict each other. `_filter_clips_for_tag`
(`materialization.py:253`) selects clips for a per-player share by joining `clip_teammates` with
**no `my_athlete` predicate**, so tagging a teammate on a **My Athlete** clip shares that clip into
another family. Meanwhile the epic's model is strictly one layer per clip, with Team as the layer
that travels.

The user resolved this at the source rather than by filtering the share:

> **Teammates can only be tagged on TEAM clips. There is no "tag a teammate" UI on a My Athlete
> clip. Therefore, when I share a game, the receiver receives all Team clips.**

## Solution

1. **Annotate UI — teammate tagging only on Team clips.** The Teammates control renders only when
   the clip is on the Team layer (`my_athlete === false`):
   - `ClipDetailsEditor.jsx` — the `Teammates` block (~L297-302, currently `!isMobile` only)
   - `AnnotateFullscreenOverlay.jsx` — the mobile add/edit teammate control
   Switching a clip **to** Team reveals the control; switching **to** My Athlete hides it. Decide
   deliberately (and state in the report) what happens to tags already on a clip being switched to
   My Athlete — the honest options are clear-on-switch (matches the invariant, gesture-scoped so it
   is a legitimate write) or leave-and-hide (invisible state that the migration would later move
   back to Team). Prefer the one that cannot produce an invisible contradiction.
2. **profile_db migration — reclassify already-tagged clips.** Any `raw_clips` row with a non-empty
   `tagged_teammates` (and/or a `clip_teammates` join row) that is currently on the My Athlete layer
   (`my_athlete = 1 OR my_athlete IS NULL`) is **moved to Team** (`my_athlete = 0`). Tags are
   PRESERVED — the clip is reclassified, not stripped. This is the user's explicit choice over
   clearing the tags.
   **Known consequence, accepted by the user:** those clips leave the My Athlete layer and therefore
   leave reels/rankings/collections eligibility (`exclude_teammate_reels_clause` keeps those on
   `my_athlete = 1`). Already-published reels are unaffected — this changes future eligibility and
   the ranking pool only. Log the affected count per profile.
3. **No defensive filter.** Do NOT add `AND my_athlete = 0` to `_filter_clips_for_tag`. The
   migration makes the data correct and the UI keeps it correct — per CLAUDE.md "correct data, not
   workarounds" / "no defensive fixes for internal bugs".

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — Teammates block (~L297),
  `handleTeammatesChange` (L162), `LayerSegmentedControl` wiring (L289)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — mobile teammate control
- `src/backend/app/migrations/profile_db/` — new versioned migration (next free version; check
  `ensure_database()` in `src/backend/app/database.py` for the current head)
- `src/backend/app/services/materialization.py` — `_filter_clips_for_tag` (L253): READ ONLY, do not
  add a layer predicate
- `src/backend/app/services/queries.py` — `exclude_teammate_reels_clause` (the downstream that makes
  the layer move consequential): READ ONLY

### Related Tasks
- Runs in PARALLEL with T5720 (public game link) — **no file overlap**. Do NOT touch `shares.py`,
  `sharing_db.py`, `pg.py`, `games.py`, the edge functions, or `App.jsx`; T5720 owns those.
- Feeds T5730 (claim/import): because teammates now imply Team, a game share can deliver ALL
  Team-layer clips.
- Builds on T5700 (the layer model + `LayerSegmentedControl`), merged.

### Technical Notes
- Knowledge docs: `.claude/knowledge/annotate.md`, `.claude/knowledge/backend-services.md`
- Legacy-NULL rule stands: `my_athlete ?? true` → My Athlete. The migration must treat NULL as My
  Athlete when deciding what to move.
- Migrations do NOT auto-run on deploy — the admin migrate endpoint must be hit per environment.
- Layer + teammate writes stay gesture-scoped; no reactive persistence.

## Implementation

### Steps
1. [ ] Hide/disable the Teammates control unless the clip is on the Team layer (desktop + mobile)
2. [ ] Decide + implement the switch-to-My-Athlete behavior for existing tags; document the choice
3. [ ] profile_db migration moving tagged clips to `my_athlete = 0`, preserving tags, with counts
4. [ ] Tests: control hidden on My Athlete / shown on Team, both viewports; switching layers both
       directions; migration moves exactly the right rows (incl. NULL-as-athlete) and preserves tags;
       a Team clip's tags survive untouched
5. [ ] Real-browser verify of the tagging flow on both layers

## Progress Log

**2026-08-01**: Created from the user's answer at T5720's design gate — resolve the
teammate/layer contradiction at the source (UI + migration) instead of filtering the share path.

## Acceptance Criteria

- [ ] No teammate-tagging affordance exists on a My Athlete clip, desktop or mobile
- [ ] Teammate tagging works unchanged on Team clips
- [ ] Migration moves every teammate-tagged My-Athlete/NULL clip to Team with tags preserved, and
      logs the count
- [ ] `_filter_clips_for_tag` is unchanged (no layer predicate added)
- [ ] Reels/rankings/collections behavior is unchanged for clips that were already Team or already
      untagged; the moved clips leave those surfaces (expected, documented)
