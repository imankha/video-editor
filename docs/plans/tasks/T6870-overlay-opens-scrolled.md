# T6870: Overlay mode always opens scrolled — page should start at scroll 0

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

User report (2026-08-11): launching Overlay mode never starts at the top — the screen always
opens already scrolled down. Expected: scroll position 0 on entry, like every other screen.

## Leading hypothesis (verify in a real browser before fixing)

`PosterMarkerLayer.jsx`'s mount-reveal effect (~296-311) calls
`scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })` to bring the
poster/thumbnail marker into view inside the horizontal timeline. But `scrollIntoView`
scrolls EVERY scrollable ancestor — including the page/main container VERTICALLY — not just
the timeline's horizontal track. If the timeline sits below the fold at mount,
`block: 'nearest'` scrolls the page down to it on every launch. The effect fires on mount,
again ~900ms later (bounded retry for the async auto-zoom race, documented in the comment
block above it), and re-fires on `visualTime` changes until first user interaction — which
would also FIGHT a user who scrolls back up during that window. That matches "always opens
scrolled" exactly.

The reveal itself is intentional and hard-won (see the long comment: async
`posterSlowmoSection` arrival, timeline auto-zoom with no prop visibility, T6630 rounds) —
the fix must keep the horizontal reveal while eliminating the vertical side effect.

## Fix direction

Replace `scrollIntoView` with manual horizontal-only scrolling of the timeline's own scroll
container: find the nearest horizontally-scrollable ancestor (or take it via ref/prop from
OverlayScreen), compute the marker-centered `scrollLeft`, and set it (smooth). This scrolls
exactly one axis of exactly one container — no page movement by construction. Keep the
retry/interaction-latch semantics unchanged.

If triage instead finds the page is scrolled by something else (e.g. autofocus on a control
below the fold, or a second scrollIntoView elsewhere in the overlay mount path), fix that —
the acceptance criteria are about the symptom, not this hypothesis.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx` — mount-reveal effect
  (~296-311), the prime suspect
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.test.jsx` — existing reveal
  tests assert `scrollIntoView` calls directly (~213-357); they must be rewritten against
  the new mechanism, not deleted — the reveal semantics they pin (mount + bounded retry +
  interaction latch + re-reveal rules) still apply
- `src/frontend/src/modes/overlay/OverlayScreen.jsx` / `OverlayMode.jsx` — mount path;
  check for other scroll/focus side effects if the hypothesis doesn't hold

### Related Tasks
- T6630 (the reveal's origin, "round 7 item 6 mount-reveal") and T6550 (poster marker
  write guard) — most recent work in this exact file
- T5140 (tutorial reshoot) — Overlay quest records this screen; opening scrolled would be
  visible in a reshoot take, one more reason to land before it

### Technical Notes
- **Real-browser verification required** (standing rule for scroll/pointer behavior —
  jsdom doesn't implement layout or scrolling; the existing test file itself stubs
  `scrollIntoView` because of this). Verify: fresh Overlay launch lands at page scroll 0
  AND the poster marker is still revealed inside the timeline, including the late
  auto-zoom case the 900ms retry exists for.
- Coarse-pointer/mobile check too: the overlay screen scrolls on small viewports, where
  the below-the-fold condition is most likely.

## Implementation

### Steps
1. [ ] Reproduce in a real browser; confirm which call scrolls the page (DevTools:
       break-on-scroll or instrument `scrollTop` at mount)
2. [ ] Implement horizontal-only reveal (single container, single axis), preserving
       mount/retry/latch semantics
3. [ ] Rewrite PosterMarkerLayer reveal tests against the new mechanism
4. [ ] Live-browser verify: scroll 0 on launch + marker still revealed (incl. post-zoom
       retry case + mobile viewport)
5. [ ] Lint + relevant test set green

### Progress Log

**2026-08-11**: Filed under Deploy Candidate from user report; hypothesis scoped to
PosterMarkerLayer's mount-reveal `scrollIntoView`.

## Acceptance Criteria

- [ ] Launching Overlay lands with the page/main container at scroll position 0, every time
- [ ] Poster marker reveal still works: visible in the timeline on mount and after the
      async auto-zoom settles; interaction latch still stops auto-follow
- [ ] User scrolling during the first ~1s is not fought by a delayed reveal
- [ ] Real-browser evidence (desktop + mobile viewport) attached
- [ ] Tests pass
