# T5550: Per-Clip Camera Picker + Extraction From the Picked Feed

**Status:** TODO
**Impact:** 7
**Complexity:** 7
**Created:** 2026-07-19
**Updated:** 2026-08-19

## Problem

A user switches to another feed precisely because the moment looks BETTER there — then
creates a clip, and the export pipeline cuts from their own camera's far-side mush. The
clip must export the pixels the user picked. The picker UX is
[UX-SPEC.md §8](UX-SPEC.md) (normative); the export contract is EPIC value row "The clip
exports the best pixels" (`raw_clips.feed_id` + `feed_time_map` export twin).

## Solution

1. **Schema:** `raw_clips.feed_id INTEGER DEFAULT NULL` (profile_db migration; NULL =
   Main — existing rows keep today's behavior). Clip start/end times REMAIN in the
   member's primary-timeline terms — `feed_id` only selects the pixel source, mapped at
   export (§8 gesture table). Natural key unchanged.
2. **Picker (§8 — implement the spec):** renders in `ClipDetailsEditor.jsx` (desktop) and
   `AnnotateFullscreenOverlay` (mobile) ONLY when ≥2 feeds **fully** cover the clip's
   span — otherwise zero chrome:
   - **Full-coverage-only tiles**: partial-coverage feeds are OMITTED entirely (never
     disabled tiles); ten phone clips usually reduce to one or two valid tiles.
   - **Main first** (`Star` badge; sublabel names the camera Main currently resolves to);
     always-visible stakes helper: *"This camera's video is used when the clip is
     exported."*
   - **Tap = pick + preview** in one gesture: stamps `feed_id` AND switches the player to
     that feed at clip start (the preview switch is session state, not a write).
   - **When stamped:** "Exports from {name}'s camera" + **`Use Main instead`** text button
     clearing the stamp — undo is one labeled click.
   - **Poster fallback chain:** feed frame at clip start → skeleton pulse → frame from
     the reference camera at the same moment → branded mark last.
   - Unaligned feed: pickable with the yellow badge; **unavailable feed:** single
     unavailable treatment, not pickable, and an existing stamp shows the ONE generalized
     warning: *"This clip's camera isn't available — it will export from Main."*
3. **Write path:** `PUT /api/clips/raw/{id} {feed_id}` (or `{feed_id: null}`) — surgical,
   one field, from the tile-tap / Use-Main gestures only.
4. **Extraction:** wherever export resolves a game clip's source (`resolve_clip_source`
   in clips.py + the export routers' game-source seams), a stamped clip maps
   `(startTime, endTime)` through the shared wall-clock into the picked feed's video +
   local times, then extracts from that feed's `games/{blake3}.mp4`. Implement the Python
   twin **`app/services/feed_time_map.py` with the SAME unit-test vectors as T5540's
   `feedTimeMap.js`** so the two can't drift.
5. **Failure semantics — loud, in the original spirit, reconciled with §8:**
   - Stamped feed unavailable for this member → the §8 warning is shown at rest in the
     picker, and export falls back to **Main** — an ANNOUNCED fallback, per spec.
   - Anything UNANNOUNCED at export time (offsets now NULL, coverage no longer spans the
     mapped range, source object gone) → FAIL the extraction with an explicit error naming
     the clip and reason. Never a silent substitution (no-silent-fallback rule).
6. **Expiry interplay:** the T4175 preserved-extract path (`_export_brilliant_clip`) must
   honor the clip's `feed_id` too — audit it.
7. **Reviewing follows the pick:** selecting a stamped clip switches the player to its
   feed (session state), so review shows what will export.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` — raw_clips schema; `src/backend/app/migrations/profile_db/` — NEW migration (version checked against sibling branches)
- `src/backend/app/routers/clips.py` — `save_raw_clip` (~911), `update_raw_clip` (~1052), `resolve_clip_source`
- NEW `src/backend/app/services/feed_time_map.py` (+ shared vectors with T5540's JS twin)
- `src/backend/app/routers/export/` — game-source resolution seams (framing.py, multi_clip.py; Code Expert maps the exact set — this dir has known duplication; missing one call site = wrong-camera exports on some paths only)
- `src/backend/app/services/auto_export.py` — `_export_brilliant_clip` feed audit
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` + `AnnotateFullscreenOverlay` — §8 picker strip
- `src/frontend/src/containers/AnnotateContainer.jsx` — stamp write wiring; select-follows-feed

### Related Tasks
- Depends on: T5540 (feedTimeMap vectors + lanes/session switching), T5530 (offsets/verdicts), T5520 (feed rows + rent state per feed)
- Feeds: T7300 (explicit stamps drive the keep-checklist pre-check rule)
- References: UX-SPEC §8 (all copy/states/gestures), § Conventions (unavailable treatment, MAIN_COLOR); Export Write-Path epic T4370-T4410 seams if landed

### Technical Notes
- Knowledge docs: [export-pipeline.md](../../../../.claude/knowledge/export-pipeline.md), [annotate.md](../../../../.claude/knowledge/annotate.md)
- L-tier (schema + export pipeline) → Architect design gate; Code Expert maps every
  game-source resolution site FIRST
- Test-first: characterization test of current extraction for an unstamped clip
  (ffprobe-level), then the stamped path against a two-feed fixture with known offsets
- A feed CHANGE on an existing clip bumps `boundaries_version` (framing crops were
  authored against other pixels); design settles post-creation editability (recommend yes,
  via the picker, with the bump)
- Gesture-based persistence: tile tap and `Use Main instead` are the only writes; the
  preview switch riding the tap is session state. Migrations never auto-run
- Greppable: `feed_id` is the one name across raw_clips, registry, and mapping modules

## Implementation

### Steps
1. [ ] Architect design doc (resolution call-site map, announced-vs-loud failure matrix, editability + version bump, T4175 interplay) — approval gate
2. [ ] Migration + schema + write path (`feed_id` on save/update)
3. [ ] `feed_time_map.py` with shared vectors; wire into `resolve_clip_source` + every export seam
4. [ ] Failure guards: announced Main fallback (unavailable, per §8) vs loud failure (unannounced inconsistency)
5. [ ] §8 picker: full-coverage tiles, Main tile + sublabel, tap=pick+preview, stamp line + Use Main instead, poster chain, unaligned/unavailable states
6. [ ] `_export_brilliant_clip` audit + fix; select-follows-feed
7. [ ] Tests: characterization (unstamped unchanged), stamped extraction correctness, both failure classes, migration, picker states

## Acceptance Criteria

- [ ] A clip stamped to feed B exports B's pixels at the correct moment (real two-feed fixture); unstamped clips export byte-identically to today (characterization test)
- [ ] Partial-coverage feeds never render in the picker; Main is first and names its resolved camera; tap picks AND previews in one gesture; `Use Main instead` clears in one click
- [ ] Unavailable stamped camera shows the one §8 warning and exports from Main (announced); unannounced inconsistencies (NULL offsets, lost coverage, missing source) fail loudly naming clip + reason
- [ ] JS/Python time-map twins share test vectors and cannot drift; every export seam honors the stamp (call-site map in the design doc)
- [ ] Expiry-sweep preserved extracts honor `feed_id`
- [ ] Migration runs via admin endpoint; all tests pass
