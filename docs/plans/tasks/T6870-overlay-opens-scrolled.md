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

**2026-08-11 (fix, 3e3a88b8)**: Replaced `scrollIntoView({block:'nearest',inline:'center'})`
with horizontal-only `scrollContainer.scrollTo({left})`. This removed the PAGE-vertical
side effect (the reported "opens scrolled down"). Real-browser QA confirmed page stays at
scrollY 0.

**2026-08-12 (follow-up: timeline's OWN horizontal scrollbar not at 0 on launch)**:
User reported the timeline's internal horizontal scroll thumb sits partway across at launch
(zoom shown 171%). Traced the exact mechanism — see the dedicated section below. VERDICT:
this is case (A), the intentional poster-marker reveal (pre-existing since T6630), NOT a new
bug and NOT caused by this task. It needs a PRODUCT DECISION (below). Status: WAITING ON USER.

## Follow-up (2026-08-12): why the timeline's own scrollbar isn't at 0 on launch

### What actually sets the timeline's scrollLeft (traced, not guessed)

Enumerated every writer of the `.timeline-scroll-container` `scrollLeft` reachable at a
fresh, idle mount:

1. **Auto-zoom** — `src/screens/OverlayScreen.jsx:371-410`. Sets `timelineZoom` (→171% in the
   screenshot) so detection markers get ≥48px spacing. It calls `setTimelineZoom` ONLY; it
   **never writes scrollLeft**. Zoom widens the content (scale 1.71×) but leaves scrollLeft 0.
2. **TimelineBase auto-scroll** — `src/components/timeline/TimelineBase.jsx:264-309`. Gated on
   `if (!isPlaying) return` (line 277) — does not fire on an idle mount.
3. **TimelineBase reset-to-start** — `TimelineBase.jsx:319-327`. Only on a progress transition
   back through the start; not at mount.
4. **PosterMarkerLayer.revealMarker** — `src/modes/overlay/layers/PosterMarkerLayer.jsx:276-289`
   (this task). Fires on mount + the 900ms retry, and **centers the poster marker** by setting
   scrollLeft. **This is the only mount-time scrollLeft writer.**

So the launch scroll is the poster-marker reveal centering `posterVisualTime`. At zoom > 100%
the content is wider than the viewport, so centering a marker that isn't at the very start
lands scrollLeft at a non-zero value → the thumb sits partway across.

This is **case (A)** and is **not a regression from this task**: the old
`scrollIntoView({inline:'center'})` centered the marker horizontally *identically*. This task
only removed the *vertical* page-scroll. The horizontal timeline scroll on launch predates it
(T6630 round 6/7 mount-reveal).

### Where the marker sits (drives how far it scrolls)

`OverlayMode.jsx:123-131` → `posterVisualTime`: the user's saved poster time if set, else the
default from `posterWindow.js selectPosterFrame`: `section.start + 2s` when a slow-mo section
exists, else `~2s`. On any clip whose thumbnail frame isn't at the very start, the reveal
scrolls the (zoomed) timeline away from 0.

### Real-component evidence (qa/T6870-reveal-aggressiveness.{mjs,json}, T6870b-*.png)

Drove the REAL `PosterMarkerLayer` at the screenshot's ~171% ratio (scrollWidth 1026 /
clientWidth 596):

| marker visualTime | marker center (content px) | already visible at scroll 0? | reveal landed scrollLeft |
|---|---|---|---|
| 3.5s (~35%) | 367 | **yes** (367 < 596) | **67** (still scrolled) |
| 9.0s (~90%) | 909 | no | 430 (clamped to max) |

Key finding: the reveal **centers unconditionally** — at vt=3.5 the marker was already fully
visible at scrollLeft 0, yet the reveal still scrolled the timeline to 67px to center it. That
is why the timeline never rests at 0 on launch unless the thumbnail frame is at the very start.

### PRODUCT DECISION NEEDED (this is why the task is WAITING ON USER)

The reveal is doing exactly what T6630 designed (guarantee the marker is visible), but it
centers even when the marker is already on screen, which reads as "the timeline opens
scrolled." Options:

- **(1) Keep centering** — accept the launch scroll as the cost of always centering the
  thumbnail frame.
- **(2) Reveal only when off-screen, minimally (recommended)** — swap `revealMarker`'s centering
  for the playhead's own `computeFollowScrollTarget` (already shared in TimelineBase): it only
  scrolls when the marker is within a 15% edge margin and moves the *minimum* needed. Result:
  timeline stays at 0 whenever the marker is already comfortably visible; only scrolls when
  genuinely needed. Small, well-tested change confined to `PosterMarkerLayer.jsx`.
- **(3) No mount reveal at all** — only reveal when the user opens the Thumbnail tab
  (`revealOnActive`), reverting T6630 round 7 item 6. Timeline always opens at 0; the marker may
  be off-screen on the Overlay tab until Thumbnail is opened.

## Acceptance Criteria

- [ ] Launching Overlay lands with the page/main container at scroll position 0, every time
- [ ] Poster marker reveal still works: visible in the timeline on mount and after the
      async auto-zoom settles; interaction latch still stops auto-follow
- [ ] User scrolling during the first ~1s is not fought by a delayed reveal
- [ ] Real-browser evidence (desktop + mobile viewport) attached
- [ ] Tests pass
