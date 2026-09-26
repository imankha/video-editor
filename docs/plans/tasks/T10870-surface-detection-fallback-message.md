# T10870: Tell the user when auto-spotlight falls back to a centered default

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-21
**Updated:** 2026-09-26

## Problem

Found live 2026-09-21 while QA'ing T10180 on a real dev account: opening Overlay/Spotlight on a
clip where player detection ran but found **zero usable bounding boxes** (confirmed cause: a
dim/dusk game clip) silently falls back to a neutral centered spotlight with no explanation.

`useHighlightRegions.js:169-193` (`defaultHighlightForRegion`) is working as designed - the
comment explicitly cites the "no silent fallbacks for internal data" rule and correctly avoids
fabricating a fake player box, logging `console.warn('[useHighlightRegions] region has detections
but no usable box for auto-select; using centered default')` instead of crashing. **The gap is
that this warning is dev-console-only.** The user sees a plain centered box on the video with
zero UI signal that auto-detection failed and the box needs manual repositioning - it looks
identical to a real (if uninteresting) auto-placed spotlight.

`DetectionMarkerLayer` (`modes/overlay/layers/DetectionMarkerLayer.jsx`) correctly renders nothing
in this case (it gates on `detection.boxes?.length > 0`), which is right - there's nothing to
click. But that means there's also no OTHER affordance telling the user why the timeline's
detection-marker row is simply absent.

## Solution

Surface the console warning's information to the user, once, non-blockingly, when
`defaultHighlightForRegion` takes the `console.warn` fallback branch (not the normal
`calculateDefaultHighlight` path used when there were never any detections to begin with -
distinguish "we tried and failed" from "there was nothing to try"). A toast or small inline note
near the spotlight settings panel: something like "Couldn't auto-detect your athlete in this
clip - drag the highlight to reposition it." Exact copy should go through `displayNames.js`
(single-source rule) and be reviewed against the T9860/T9550 vocabulary conventions ("athlete",
not "player").

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` (lines 169-194,
  `defaultHighlightForRegion`) - where the fallback fires and the existing `console.warn` lives
- `src/frontend/src/modes/overlay/layers/DetectionMarkerLayer.jsx` - confirms zero markers when
  `detection.boxes` is empty; no change needed here, just context
- `src/frontend/src/config/displayNames.js` - new copy string
- `src/frontend/src/screens/OverlayScreen.jsx` / `modes/overlay/OverlayMode.jsx` - likely mount
  point for a toast/inline note

### Related Tasks
- Found during T10180's live QA (2026-09-21) - unrelated to T10180's own scope, filed separately
  per the user's request rather than folded in

### Technical Notes
S/M-tier: single warning-to-UI wire-up, no new detection logic, no backend change. The hard part
is distinguishing "detections existed but had no usable box" (this task's case) from "no
detections at all" (a clip with zero sampled-frame data, a different and already-silent case that
may or may not need its own message - worth a quick check during implementation, not assumed
in scope here).

## Implementation

### Steps
1. [ ] Confirm exactly which `defaultHighlightForRegion` branch corresponds to "tried, found
   nothing usable" vs "never had detections" - only the former should show this message
2. [ ] Add the copy string to `displayNames.js`
3. [ ] Surface it once per region (not on every re-render) via a toast or dismissible inline note
4. [x] Test: a region with detections-but-no-boxes shows the message; a region with real detected
   boxes does NOT show it; a region with zero detections at all does not show this specific message

### Progress Log

**2026-09-26**: Merged PR #518 (bae7809b). Implemented as a `toast.info(...)` fired from
`defaultHighlightForRegion`'s existing `console.warn` branch only, once per region (ref-backed
guard + Toast dedupKey). First proof round was sent back by an independent proof-verifier
(MORE_PROOF_REQUIRED): the once-per-region test asserted toast array length, which stayed 1
even with the guard fully removed because `Toast.jsx`'s `dedupKey` already collapses same-key
store entries regardless of call count - a mutation test proved the gap. Fixed by spying on
`addToast` call count + toast id stability; re-verified by fresh reviewer (APPROVED, 0
blocking/major) and proof-verifier (VERIFIED) against the corrected evidence, CI green on the
final head, landed via `scripts/landing_gate.py`. MINOR (non-blocking, left as-is): reviewer
noted `region?.id || 'unknown-region'` is a small silent fallback on internal data.

## Acceptance Criteria

- [x] When auto-spotlight falls back to a centered default because detection found no usable box,
      the user sees a clear, non-blocking explanation (not just a console warning)
- [x] The message does NOT appear when a real detection box was successfully used
- [x] Copy lives in `displayNames.js`, matches existing athlete/spotlight vocabulary
- [x] Relevant test set green
- [x] Branch CI green
