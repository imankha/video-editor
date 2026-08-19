# T7190: Quest panel occludes home-screen content

**Status:** DONE (deployed 2026-08-19 prod)
**Impact:** 4
**Complexity:** 1
**Created:** 2026-08-18
**Updated:** 2026-08-18

## Problem

On the Home screen, the "Get Started" onboarding QuestPanel visually overlapped the
games/reel-drafts list above it instead of flowing below it — e.g. it covered the bottom
of the "Vs Rangers Jul 26" game card for new users.

## Root Cause

`QuestPanel` renders with `inline` on Home ([App.jsx:796](../../../src/frontend/src/App.jsx#L796)),
switching its wrapper to `position: relative`. But
[QuestPanel.jsx:208](../../../src/frontend/src/components/QuestPanel.jsx#L208) still applied the
`positionStyle` computed for the *fixed*-overlay case (`{ left: 24, bottom: 40 }`) via inline
`style`, unconditionally. `position: relative` (unlike `static`) still honors `top/left/bottom/right`
offsets — it shifts the box from its natural flow position without freeing the space it vacated,
so the panel rode up over whatever preceded it in the DOM. A comment at the old line 210-211
incorrectly assumed the offsets were inert for the static/inline case.

## Solution

Only compute/apply `positionStyle` when not `inline` — the home screen's `relative` panel needs
no offset since it already flows correctly in the document.

## Context

### Relevant Files
- `src/frontend/src/components/QuestPanel.jsx` - `positionStyle` now `undefined` when `inline`

## Acceptance Criteria

- [x] Home-screen QuestPanel flows below game/reel-draft content, no overlap
- [x] Fixed-overlay QuestPanel (editor modes) positioning unchanged
- [x] Verified in browser: reproduced original overlap by reverting the fix, confirmed fix
      resolves it
