# T11920: Remove autoProjectId from regions; highlightInstances is the one datum

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Tier:** L (6+ files, behavior change needs approval first)
**Created:** 2026-10-06

## Epic Context

Follow-up to [T11910](T11910-highlight-instances-server-sync-and-orientation-slots.md) in [Epic D](EPIC.md).
Runs after T11910 is merged and the list is proven reliable on staging.

## Problem

`region.autoProjectId` duplicates what `highlightInstances` says ("this play has a highlight"), so
two sources can disagree. After T11910 these still read the legacy pointer, so the fullscreen
overlay can disagree with the slots: `AnnotateModeView.jsx` (the selected-region framing lookup and
the playback `getClipStage` near L478-495), `AnnotateScreen.jsx` (L236-256 switch-to-framing, L287),
`ClipDetailsEditor.jsx:128`, `AnnotateFullscreenOverlay.jsx:406`, `FramedBanner.jsx:31,38`,
`AnnotateContainer.jsx` (choice card and the clean-check), `games.py:2557` load payload.

## Solution

- Remove `autoProjectId` from regions and the load payload (the `raw_clips.auto_project_id` column
  stays on the server). "Has a highlight" becomes `highlightInstances.length > 0`. "Which project to
  open" becomes a selector `activeDraftInstance(region)`: the unpublished instance with the highest
  project id.
- **Behavior change needing the user's approval before implementing:** today "switch to framing"
  does nothing when the newest highlight is published (`publishedBail`); afterwards it opens the most
  recent unpublished draft.
- Remove now-unused copy: `ANNOTATE.MAKE_ANOTHER_HIGHLIGHT`, `ANNOTATE.FRAME_THIS_CLIP_HINT` (verify
  zero callers in `src/`, `e2e/` and `scripts/` first), and the `primaryCta` from `getClipStages`.

## Pre-work (evidence, not assumption)

Measure on prod whether any play's `raw_clips.auto_project_id` points at a project with
`projects.is_auto_created = 0` or a multi-clip reel. Such plays show an empty list today and now two
Make buttons (Make creates a new auto project and repoints the pointer, the custom project is left
untouched). Decide what those plays should show before deleting the pointer.

## Acceptance Criteria

- [ ] No reader of `region.autoProjectId` remains in `src/`, `e2e/` or `scripts/`
- [ ] Fullscreen overlay, playback and slots agree for every state
- [ ] Prod measurement recorded in the Progress Log
- [ ] User approved the publishedBail behavior change
