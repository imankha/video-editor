# T9290: Mobile Home screen's top bar visually overlaps content when scrolling

**Status:** STAGING
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-09

## Problem

Reported by the user on mobile staging 2026-09-09 (screenshot attached in conversation): on the
Home screen (`ProjectManager`), the top region — the current-game context bar (game title,
download/share/folder actions, sport badge, avatar) sitting above the Games/Clips/Reels/Published
tab row — visually overlaps the scrolled tile content beneath it instead of cleanly staying above
or getting out of the way. The user's words: "I hate that when I scroll the top row shows
overlapping UIs."

The user offered two candidate fixes, is open to others:
1. Don't show the game/player context card once the user has scrolled away from the very top
   (their note: "now we only have 1 row of intersection" — i.e. this alone may be enough).
2. Give the top row a solid/opaque background so tile content scrolls fully BEHIND it instead of
   visually intersecting with it.

## Solution

Not yet designed — needs live reproduction on mobile staging first to confirm exactly which
element(s) are involved (the game-context bar, the tab row, or both) and whether the current
implementation uses `position: sticky`/`fixed` with an insufficiently opaque background, a z-index
conflict, or something else. Once reproduced, decide between the user's two proposed directions
(or a combination — e.g. solid background AND collapse/hide the context card on scroll) with a
quick design pass; this is a small enough UI change that a full ui-designer spec is probably
overkill, but confirm live at 375-428px before and after.

## Context

### Relevant Files (anticipated — confirm during investigation)
- `src/frontend/src/components/ProjectManager.jsx` — Home screen, tab bar
  (`GAMES_GROUP_HEADER_CLASS` and other sticky/header classes live here; grep `sticky`)
- Whatever renders the current-game context bar shown in the screenshot (title, download/share/
  folder icons, sport badge, avatar) — not yet located; find it during investigation, it did not
  turn up under an obvious name (`GameContextBar`/`CurrentGameBar` etc. don't exist) so it may be
  inline in `ProjectManager.jsx` or a differently-named shared component

### Related Tasks
- Adjacent, same screen: T8980/T8990 (empty/partial tab guidance, `CardCarousel` filler
  mechanics) — unrelated mechanism but same screen, worth reading for context on what's already
  fragile there
- [T9270](T9270-focus-overlay-cta-band-settings-rail.md) is a similar "action band + collapsible
  rail" layering exercise on Focus/Overlay — not the same screen, but may be a useful reference
  for how sticky/solid-background bands were designed elsewhere in this app if the same pattern
  fits here

### Technical Notes
- Confirm on a REAL mobile browser/viewport (375-428px), not just resizing desktop Chrome —
  scroll-based overlap bugs are exactly the class of thing that reads differently on a real
  touch scroll (momentum, address-bar collapse) per the T5380 precedent.
- Whatever fix is chosen, it must not persist any new view state (no-persisted-view-state rule)
  and must not introduce a reactive `useEffect` writing to a store in response to scroll — pure
  CSS (opacity/background/position) or local scroll-position `useState` only.

## Acceptance Criteria
- [ ] Reproduced live on mobile staging with a description of exactly which elements overlap and
      why (sticky/fixed + transparent background, z-index, or other)
- [ ] Fix implemented and verified at 375px and 428px, scrolled and at rest
- [ ] No regression to the tab row's existing sticky/reachable behavior
- [ ] Tests pass (add a scroll-position layout test if a reasonable one exists; otherwise a
      live-verified screenshot before/after is acceptable evidence per this task's small scope)
