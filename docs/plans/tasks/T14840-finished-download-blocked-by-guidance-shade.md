# T14840: Finished: Download is dead under the last Guidance card (shade has no cutout for it)

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Prod Journey (2026-11-03): **Finished highlight 19 reached, 8 lost (1 stuck, 7 gone)**, i.e.
42% of parents who finished a highlight never downloaded or shared it, on a step that is one
tap. Reproduced on master (2026-11-03 walk-through, desktop 1280x800, Guidance on, fresh
account):

1. Finish lands on the finished player with Download (top right) and Get share link (bottom).
   The coach says "Done! Tap Get share link to send it, or Download to save it." Got it.
2. Tap Get share link. The link appears. The coach now shows the closing card "Keep going:
   upload videos, mark plays and make highlights. Turn guidance off for now..." with a full
   shade (`data-testid="guide-shade"`, `fixed inset-0 z-[110]`).
3. The shade's cutouts are the guidance toggle, the player close button, the video and the
   share bar. **Download is outside every cutout**, so tapping it does nothing
   (Playwright: "guide-shade intercepts pointer events"). The parent has to find the card's
   "Turn off guidance for now" or its X first. A parent who came to download and sees the
   dimmed button taps it, nothing happens, and leaves.

Guidance is on by default for new accounts, so every first-time parent hits this.

## Solution

- The closing "Keep going" card never shades the screen (it is informational; render it as an
  unshaded floating card like the progress/error cards in `FloatingCoach.jsx`), or
- if it keeps the shade, add Download and Get share link / Copy link to `SHADE_ALWAYS_CLEAR`
  (the selector list that always cuts out) for the Finished player.

Prefer the first: a card whose only purpose is "turn guidance off" should not block anything.
Also audit the other closing/transition cards for the same pattern (post-export ready screen,
Spotlight set) with a unit test that asserts every primary action on the screen is inside a
cutout whenever a card is shaded.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/instructions/FloatingCoach.jsx` - shade, `SHADE_ALWAYS_CLEAR`, cutout computation
- `src/frontend/src/components/instructions/resolveGuide.js` + GUIDE copy table - the closing card rule id and its `focused`/shaded flag
- `src/frontend/src/components/PublishedReelsPanel.jsx` (finished player, Download button, `finished-get-link`)
- `src/frontend/src/components/instructions/FloatingCoach.*.test.jsx` - add the cutout-covers-primary-actions test

### Related Tasks
- Related: T14760 (shade left up with no card on Frame), T11510 (share video vs share link on mobile), T12580 (guide system), T12800 (shade z-order).
- Knowledge: `.claude/knowledge/guidance.md` (GuideScope, pulse targets, invariants).

### Technical Notes
- Keep the fix in the guide layer; do not add per-screen z-index hacks.
- The share bar cutout already exists, which is why Get share link works while Download does not.

## Implementation

### Steps
1. [ ] Failing test: with the closing card shown on the Finished player, Download must be clickable (cutout contains its rect or no shade).
2. [ ] Fix per the preferred option; run the FloatingCoach tests.
3. [ ] Live check on phone (390x844) and desktop with a fresh `empty` preset account through Finish -> Get share link -> Download.

### Progress Log

**2026-11-03**: Filed from the funnel walk; reproduced on master. Not started.

## Acceptance Criteria

- [ ] After Get share link, Download works without dismissing the guidance card.
- [ ] A test proves every primary action stays tappable under any shaded card on the Finished player.
- [ ] Tests pass.
