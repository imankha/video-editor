# T13220: Annotate: import a Veo zip as suggested plays

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** L (frontend, new Annotate surface; ui-designer for the list, timeline ticks and sheet)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Epic:** [Veo Highlights Import](EPIC.md) (Path A). Depends on T13200, T13210.

## Problem

A parent with the full Veo game in Annotate has to scrub 90 minutes to find moments Veo already
found, timestamped to the second, in the zip they downloaded.

## Solution

1. **Entry:** in Annotate, the Add footage area gets "Import Veo highlights (.zip)" (exact copy per
   V5); the game kebab gets the same row. File picker accepts `.zip` and loose Veo mp4s.
2. **Import sheet** (no backdrop close): reads the zip with T13200 in a worker with a progress bar
   ("Reading 41 highlights..."), shows "35 moments: 4 goals, 27 shots, 3 attacks, 1 highlight", asks which video
   the stamps belong to when the game has 2+ videos (V6), then **Import** (one gesture -> one POST).
3. **Alignment check:** after import, seek to the first suggestion; card: "Does the play start here?"
   with -1 s / +1 s / Looks right. Nudges call the Shift endpoint. A "Remove import" row undoes it.
4. **Timeline:** suggestion ticks on the Annotate timeline in a color distinct from plays (ui-designer;
   respect the guide system and reduced motion). Tapping a tick seeks there.
5. **Suggested plays list** (filter chips by label, open/dismissed): row = label, `mm:ss`, duration.
   Row actions: **Make it a play** -> existing Mark-play save path with `[start, end]`, tag Goal for
   Goal (V3), rating unset, then the play editor opens on it (same as after Mark play); **Dismiss**.
   Accepted rows show "Play" and jump to it.
6. Guide: add a guide entry for the list per `.claude/knowledge/guidance.md` (scope with the guide owner).

## Acceptance

1. Real-browser e2e on dev with the Rebels fixture manifest (or a small synthetic Veo zip): import ->
   35 rows -> Make it a play on the 14:44 goal -> play exists at the right time with tag Goal -> reload
   -> state persists.
2. No network request to anything except our API during import (asserted in e2e; T2680 rule).
3. Every write traces to a gesture (reviewer checks; no effect-driven writes).
4. Phone (390) and desktop (1440) screenshots of the sheet, list and ticks.

## Knowledge docs
`.claude/knowledge/annotate.md`, `.claude/knowledge/guidance.md`.
