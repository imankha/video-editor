# T8535: Consolidate DraftTile's separate draft-preview modal into the DraftReelPreview player

**Status:** WIP
**Impact:** 3
**Complexity:** 3
**Created:** 2026-09-04
**Updated:** 2026-09-04

## Problem

T8530 shipped `DraftReelPreview` (the `reelPreviewStore` + `openFinishedReel(project)`
preview/publish player). But `DraftTile` still opens its OWN draft preview in a portaled
`MediaPlayer` modal (`DraftTile.jsx` ~872-903) — a second "watch your draft" shell with
different chrome and NO publish affordance. Two surfaces for the same job.

## Solution (a few lines — full analysis already written)

Consolidate to ONE draft surface: make `DraftTile`'s Preview button call
`openFinishedReel(project)` (the T8530 helper) instead of mounting its own `MediaPlayer`
modal, so Publish is always at hand. The `quest_4` `previewed_draft_reel_1s` timer
(`DraftTile.jsx` ~270-287) must move into the `DraftReelPreview` wrapper as part of the
move (do not drop the quest-step instrumentation).

This is **D4 / Option B** from the ui-spec — see
`docs/plans/tasks/T8520-T8530-ui-spec.md` **section 5** for the source-grounded analysis,
tradeoffs, and the reason it was deferred out of T8530 (T8530 was already carrying an
extraction, a new store, a wrapper, and a shared prop contract).

## Context

### Relevant Files
- `src/frontend/src/components/DraftTile.jsx` (~270-287 quest timer, ~872-903 MediaPlayer modal)
- `src/frontend/src/components/DraftReelPreview.jsx` (destination wrapper)
- `src/frontend/src/utils/finishedReelNav.js` (`openFinishedReel`)

### Related Tasks
- Follow-up to T8530 (shipped the wrapper). Depends on nothing else.

## Acceptance Criteria

- [ ] One draft-preview surface everywhere; the `DraftTile` `MediaPlayer` modal is gone
- [ ] `previewed_draft_reel_1s` quest timer still fires from the consolidated surface
- [ ] Publish reachable from the tile's Preview, not just the completion flow
