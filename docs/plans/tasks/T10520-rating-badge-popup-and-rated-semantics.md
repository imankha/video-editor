# T10520: Rating badge becomes a real popup; "rated" means set, not "not 4"

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-18
**Updated:** 2026-09-19

## Problem

Round 3 of the play-progress badges (follow-up to T10410/T10440/T10450). User tested
round 2 (the rated badge expanding in place into a bare inline star column) live and
gave four pieces of feedback:

1. It should completely replace the OTHER rating control — `DetailsFields`' own
   horizontal star row (inside the "Rate and Tag" disclosure) was still there,
   duplicating the badge.
2. "Green doesn't mean not 4, it just means it's been set" — `rated` compared the
   rating against the untouched default (4), so a deliberate 4 read as un-rated.
   That comparison should go away entirely.
3. "It should be able to be set again and again too" — once DONE, the rated badge
   became an inert span like the other badges; it should stay clickable so the
   rating can be changed later.
4. "Need more space when it's in selection mode, maybe put it in a box and treat it
   more like a popup. Should look good and be big enough to press on mobile" — the
   bare inline star column was cramped and a poor touch target.

## Solution

**`RatingBadge` (`PlayProgressBadges.jsx`)** is now a real popup again (like round 1),
but bigger and touch-friendly: `position: absolute`, bordered/padded/shadowed box
(`bg-gray-800 border-gray-700 rounded-xl shadow-xl`), five rows (star count +
`RATING_ADJECTIVES` label), each `coarse-pointer:min-h-[44px]` for mobile. The
collapsed disc is now ALWAYS a `<button>` — no more `actionable`/`BADGE_STATE.UNDONE`
gate — so it stays clickable once DONE, re-opening the same popup with the current
value highlighted. Outside-click/Escape still close it.

**`playProgress.getPlayProgress`**: `rated` no longer compares against a default.
It's `isEditMode || isRatingManuallyEdited` — edit mode is ALWAYS rated (a saved play
always carries a genuine 1-5 value, whatever it is); create mode is rated once the
rating control has been touched this session (`isRatingManuallyEdited`, a new
session-scoped flag in `AnnotateFullscreenOverlay.jsx`, same shape as
`isNameManuallyEdited`, set true in `handleRatingChange`, reset on a real clip
switch). The `defaultRating` param is gone from `getPlayProgress` entirely.

**`DetailsFields.jsx`**: the Rating block is deleted. It no longer takes
`rating`/`onRatingChange`/`showKeyHint` props. The rated badge's popup is now the
ONLY rating control on every surface EXCEPT `landscape-inline`, which has no badges
at all (height-starved) and keeps its own bespoke inline `StarRating` row directly in
`AnnotateFullscreenOverlay.jsx` — untouched by this change. `AddDetailsPopup.jsx`
(the mobile full-screen details takeover) also dropped its now-dead
`rating`/`onRatingChange` passthrough.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` - `RatingBadge` rewritten as a popup, always-clickable
- `src/frontend/src/modes/annotate/playProgress.js` - `rated` semantics rewritten
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - `isRatingManuallyEdited` state + wiring, dropped `rating`/`onRatingChange` from `DetailsFields`/`AddDetailsPopup` call sites
- `src/frontend/src/modes/annotate/components/DetailsFields.jsx` - Rating block removed
- `src/frontend/src/modes/annotate/components/AddDetailsPopup.jsx` - dropped dead props
- Tests: `playProgress.test.js`, `AnnotateFullscreenOverlay.progressBadges.test.jsx`,
  `.mobileStageCta.test.jsx`, `.focusPrompt.test.jsx`, `.saveStatus.test.jsx`,
  `.keys.test.jsx`, `.layer.test.jsx`, `.oneTap.test.jsx`

### Related Tasks
- Round 3 of T10410 (shipped) -> T10440 (undone color) -> T10450 (order + round 2
  expand-in-place, since renamed T10460 after an id collision) -> this task.

## Implementation

### Steps
1. [x] `RatingBadge`: popup box, always-clickable button in every state
2. [x] `playProgress.rated`: `isEditMode || isRatingManuallyEdited`, drop `defaultRating`
3. [x] `isRatingManuallyEdited` session flag wired into `handleRatingChange` + reset effect
4. [x] Delete `DetailsFields`' duplicate Rating block; drop dead props from it and `AddDetailsPopup`
5. [x] Update every test that assumed the old disclosure star row or the old "differs from default" rule
6. [x] Live-drive verified in a real browser

### Progress Log

**2026-09-19**: Lint clean (0 errors; only pre-existing unrelated warnings). Full
related suite (`vitest related` across all 5 changed source files): 33 files, 229
tests, all green — this took two passes to get there, since the semantic change to
`rated` (edit mode is now ALWAYS done, not just when it differs from 4) and the
removal of the disclosure's star row broke 8 pre-existing tests across 5 files that
assumed the old behavior (`AnnotateFullscreenOverlay.keys/layer/oneTap/mobileStageCta/
focusPrompt/saveStatus/progressBadges.test.jsx`); all rewritten to match the new
mechanics rather than skipped or deleted. Live-drive: spun up a real game + play in
the actual browser (dev-login, uploaded the `staging-verification-fixture-5min.mp4`
fixture, marked a play) and confirmed all four pieces of feedback directly — order,
the popup box (bordered, roomy, adjective labels), the badge staying clickable and
reopening with the current value highlighted after being set to 5 stars, and the
disclosure showing Tags directly with no Rating row above it.

## Acceptance Criteria

- [x] `DetailsFields` carries no Rating control anywhere it coexists with the badge
- [x] `rated` is `isEditMode || isRatingManuallyEdited` — no default-value comparison
- [x] The rated badge is a `<button>` in every state, not just while undone
- [x] Clicking it (in any state) opens a bordered/padded popup box, not a bare
      inline expansion, with `coarse-pointer:min-h-[44px]` rows
- [x] Tests pass; live-verified in a real browser
