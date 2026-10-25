# T13240: Route a dropped Veo zip to the right path

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Tier:** M (frontend, ~3 files)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Epic:** [Veo Highlights Import](EPIC.md) (Routing). Depends on T13220 and T13230.

## Problem

Parents will drop the zip wherever they upload things: the game intake (`GameFootagePicker` /
`useFootageIntake`), Annotate's Add footage, or Add Clip. Today the game intake treats a zip as an
invalid video (and T12830 shows invalid files can dead-end).

## Solution

- Detect with T13200's `isVeoHighlightsZip` at every intake.
- Candidate games: owned games whose opponent MATCHES the zip name's opponent (`Veo highlights {Team}
  vs. {Opponent}.zip`, normalized, whole-word prefix either way) AND whose video is at least
  `last_stamp + last_duration` long; newest first. (User decision 2026-10-25: length alone offered
  unrelated games; a zip without "vs." matches none. A game with no/misspelled opponent is still
  reachable from its own Annotate "Import Veo highlights (.zip)".) Show **"Add as suggested plays to {game}"** first (Path A), **"Upload as
  clips"** second (Path B). No candidate: Path B directly, with a line saying that uploading the full
  Veo game first gives suggested plays instead.
- Game intake receiving only a Veo zip never creates a game.

## Acceptance

1. Zip on game intake with a matching game -> offer A; choosing it lands in T13220's import sheet.
2. Zip on game intake with no game -> Path B pick list; no game row created (test).
3. Zip on Add Clip with a matching game -> both options offered, A first.

## Knowledge docs
`.claude/knowledge/annotate.md` (upload intake).
