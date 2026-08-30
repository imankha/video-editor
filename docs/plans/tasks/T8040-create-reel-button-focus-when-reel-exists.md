# T8040: Replace disabled "Create Reel" button with a Focus button when a reel already exists

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-29 (reported live-testing staging)
**Updated:** 2026-08-29

## Problem

In the Annotate clip details panel (`ClipDetailsEditor.jsx`), once a clip already has an
auto-created reel (`region.autoProjectId` set, or a same-session `Create Reel` click),
the "Create Reel" button just goes disabled and reads "Reel Created" — a dead end. The
user wants it replaced with a button that takes them straight into Focus mode with that
reel loaded, since that's the natural next action once a reel exists for a clip.

## Solution

When `reelCreated` is true, render an enabled "Focus" button instead of the disabled
"Reel Created" button. Clicking it navigates into Focus mode (`EDITOR_MODES.FRAMING`)
against the clip's project (`region.autoProjectId`), landing on that clip — mirroring the
existing "open in Focus" entry points (e.g. `DraftTile`'s per-clip-segment click,
`RecapPlayerModal`'s recap-clip flow) rather than inventing a new navigation path.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — the button (L338-355)
- `src/frontend/src/containers/AnnotateContainer.jsx` — owns `EDITOR_MODES`/project
  selection; needs the handler that ClipDetailsEditor's new button calls
- `src/frontend/src/modes/annotate/index.js` / `AnnotateModeView.jsx` — prop threading
  from container to `ClipDetailsEditor` if a new `onOpenInFocus`-style handler is needed

### Technical Notes
- `region.autoProjectId` is the project id to open (set on create-reel success; present
  once a reel exists even across reloads — not just the same-session `reelRequested` flag).
- Follow the existing "clip segment click -> Focus" pattern (`.claude/knowledge/annotate.md`
  Landmines § "A draft tile opens Focus on BODY click..." / T7790b) for how a project+clip
  pair should be handed to Focus, rather than a bespoke navigation.
- Gesture-based only — this is a click handler, no persistence changes.

## Implementation

### Steps
1. [ ] Add a handler (container level) that switches `EDITOR_MODES.FRAMING` for the
   clip's `autoProjectId`, selecting that clip.
2. [ ] Thread it down to `ClipDetailsEditor` and swap the disabled "Reel Created" state
   for an enabled "Focus" button (icon + label) when `reelCreated`.
3. [ ] Unit test: button renders correctly in both states; click navigates/fires the
   handler with the right project/clip.

## Acceptance Criteria

- [x] Clip with an existing reel shows an enabled "Focus" button, not a disabled one.
- [x] Clicking it opens Focus mode on that clip's reel.
- [x] A clip with no reel yet still shows the original "Create Reel" button, unchanged.
- [x] Targeted frontend unit tests pass.

## Progress Log

**2026-08-29**: Implemented (ClipDetailsEditor, ClipsSidePanel, AnnotateScreen +
`openClipInFocus`). Reviewer agent found 2 MAJOR issues: (1) `selectProject` wasn't
awaited before `onModeChange('framing')`, which on the button's primary path
(opening a game fresh, no project pre-selected) would route through Home for the
duration of the fetch and strand the user there silently on failure; (2) the
persist-view-progress block (`finishAnnotation` + `saveLastPlayhead`) hit its 3rd
copy. Both fixed: `openClipInFocus` now awaits `selectProject`, toasts + bails on a
null result (mirrors `ProjectsScreen.handleSelectProjectWithMode`), and the shared
block is extracted into `persistAnnotateProgress`. Also addressed reviewer MINOR
findings (EDITOR_MODES.FRAMING constant, dropped redundant `reelCreated` alias,
`cyan` instead of `success` for the actionable button, non-optional `onOpenInFocus`
call, added prop-wiring + mobile-hidden test coverage). 28 targeted unit tests
green, `npm run build` clean. Branch pushed, PR #309 opened against master.
**Not manually verified in a browser this session** — local dev-login/API calls in
this sandboxed environment hung repeatedly investigating T8030, and re-attempting
for T8040 wasn't worth the risk of losing more time; flagging this explicitly
rather than claiming a live-tested result. Recommend the user click through the
flow (a clip with an existing reel -> Focus button -> lands in Focus on that reel)
before merging.
