# T8460: Silent app update, no blocking interstitial

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

The literal first frame a brand-new user sees on staging is a full-screen "A new version
is ready / Update now" modal covering the dimmed home screen (walkthrough screenshot
01-home-empty.png, 2026-09-02). The user must click through it before touching anything.

This is the strongest candidate yet for prod bug #18 ("I hit add your first game and
nothing happened", iPhone 352x541): an update gate stealing the first tap or reloading
mid-gesture looks exactly like a dead Add Game button. Cliff 1 (50% of users never start
an upload) was measured with this wall in place.

User decision 2026-09-03: the user should NEVER need to click update. Update silently;
if the swap takes time, report progress during it. Delete the click-gated flow, do not
just re-time it.

## Solution

- Remove the blocking modal as a user-facing gate. On detecting a new version, flush
  pending work (the existing updateFlush barrier), then swap and reload automatically.
- While the flush + reload runs, show a small non-interactive progress indicator
  ("Updating to the latest version...") instead of a button.
- Preserve the existing safety invariants: the flush-before-reload barrier stays
  (updateFlush.js is invoked from the update path only, never reactively), and the
  same-bundle no-gate guard from appVersion.js stays (its regression test documents the
  old "Update now reloads onto the SAME bundle" bug).
- Timing rule: never trigger the auto-swap mid-gesture or mid-upload. Piggyback on the
  existing barrier: defer the reload until the app is quiescent (no in-flight upload, no
  open modal, no active export), and never interrupt a first session before the user's
  first meaningful action completes.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/UpdateGateModal.jsx` - the blocking modal (to be removed/reduced to progress toast)
- `src/frontend/src/stores/updateGateStore.js` - gate state + "Update now" gesture barrier
- `src/frontend/src/utils/updateFlush.js` - flush-before-reload (keep; now invoked automatically)
- `src/frontend/src/utils/pwaUpdate.js` - service worker update detection
- `src/frontend/src/utils/appVersion.js` + `appVersion.test.js` - same-bundle no-gate guard (tests must keep passing)
- `src/frontend/src/screens/FocusScreen.jsx:395` - references the update gesture; re-wire

### Related Tasks
- Epic: first-reel-funnel. Watch prod bug #18 recurrence after ship.

### Technical Notes
The gesture-persistence rule is about backend writes; an automatic reload is not a
persisted write, but the flush inside it IS. Keep the flush inside the update path (not
a reactive effect watching version state). The quiescence check must be explicit state
reads at swap time, not a useEffect persisting anything.

## Implementation

### Steps
1. [ ] Trace the current detect -> gate -> flush -> reload path end to end
2. [ ] Replace gate modal with auto flush + reload at quiescence; add progress indicator
3. [ ] Keep and extend appVersion tests (same-bundle guard, quiescence deferral)
4. [ ] e2e: fresh session with a pending update never shows a blocking modal and Add Game stays tappable

## Acceptance Criteria

- [ ] No user click is ever required to update
- [ ] Update never fires mid-upload, mid-export, or before a first session's first action
- [ ] Progress is visible during a slow swap
- [ ] appVersion same-bundle regression tests still green
- [ ] Verified at 390x844: no update UI ever occludes a tap target
