# T10230: Re-verify the three React #185 crash paths on redeployed staging

**Status:** TODO
**Impact:** 10
**Complexity:** 2
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

The user's 2026-09-17 staging run hit `Minified React error #185` (Maximum update depth exceeded)
three times on the `hello@reelballers.com` staging account:

1. clicking the stage CTA on the only marked play in the only game (rendered as "View Final");
2. opening a freshly uploaded clip from the Clips tab;
3. going to Framing directly.

Code trace (2026-09-17) shows **all three converge on one surface**: `openClipInFocus` /
`DraftTile.handleCardClick` / `useProjectLoader` (`targetMode = mode || 'framing'`) all land in
`FocusScreen` -> `FocusModeView` -> `useVideoDisplayRect`. That is exactly the surface T10200
fixed (commit `2fefc85a`, a fresh `panOffset` literal per render). The staging frontend deploy
carrying T10200 completed **2026-09-17 10:49 UTC**; the user's run may have pre-dated it or hit a
service-worker-cached bundle (the Fast App Update epic documents that a waiting bundle can sit
for a long time).

## Solution

Verification first, then root-cause only if it still reproduces:

1. Hard-reload staging (bypass the SW: DevTools > Application > Service Workers > Update, or an
   incognito window) and confirm the bundle hash differs from `vendor-react-CGAGbR8z.js` /
   `index-VfqkVJmd.js` quoted in the report.
2. Drive the three paths on `hello@reelballers.com` via the drive-app-as-user skill with the
   console captured. Also re-run T7170's real-browser flicker check while there (its pending
   staging step).
3. If any path still throws #185 on the current bundle: capture the component stack with the
   non-minified build (dev stack against the same account data), then escalate to the expert
   agent with `useVideoDisplayRect`'s remaining reference-typed deps (`metadata`, the
   `videoRef`/container path) as the starting hypothesis. Do not guess-fix.
4. Record the verdict on T10200's PLAN.md row and on T9950's flag.

## Context

### Relevant Files
- `src/frontend/src/modes/FocusModeView.jsx:144,338` (T10200 fix, `PREVIEW_ZERO_PAN`)
- `src/frontend/src/hooks/useVideoDisplayRect.js:165` (reference-typed effect deps)
- `src/frontend/src/screens/AnnotateScreen.jsx:230-243` (`openClipInEditorMode`)
- `src/frontend/src/components/DraftTile.jsx:212-246`, `src/frontend/src/hooks/useProjectLoader.js:120`
- `src/frontend/src/modes/FocusModeView.outputPreview.test.jsx` (T10200 regression test)

### Related Tasks
- Depends on: T10200 (STAGING)
- Related: T10240 (the CTA should not have said "View Final" at all), T7170 flicker check

## Acceptance Criteria

- [ ] All three paths open Framing without a console error on the current staging bundle
- [ ] Bundle hash recorded in the progress log, with the account and timestamps
- [ ] If reproduced: root cause identified by the expert agent and fixed with a regression test
