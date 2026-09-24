# T11160: Team plays become highlights like any other

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

Owner ruling 2026-09-24 (H13): "people should be able to make highlights out of team clips."
The UI says they can't: `getEditRatingCaption` returns "team plays don't create clips"
(`clipConstants.js:109`, used at `ClipDetailsEditor.jsx:132,261`).

## Finding (audit 2026-09-24)

**Nothing actually blocks it.** Every creation path already works for Team plays with no layer
check: `clipStage.js:55-75`, the 5-star nudge (`playProgress.js:100`,
`AnnotateFullscreenOverlay.jsx:385-389`), Frame Now/Later (`AnnotateModeView.jsx:249,264`),
recap "Create clip" (`RecapPlayerModal.jsx:236-244`), backend `create_project`
(`clips.py:1340-1383,1491-1494`), batch upload with `my_athlete=0` (`clips.py:2160-2173`), and
shared-in team 5-star plays auto-draft (`materialization.py:932-935`). The only "block" is the
caption plus the tests pinning it (`clipConstants.test.js:141-146`,
`ClipDetailsEditor.layer.test.jsx:143`).

## Solution

1. Team plays rated Highlight get the same Done popup (T11130 must NOT add a layer check).
   Remove the caption (T11150 rewrites the rating copy anyway) and its pinning tests.
2. Downstream behavior once team highlights are common, each per the owner's answer:

| # | Surface | Today | Question |
|---|---|---|---|
| T1 | Game-card star count (`brilliant_count`, `games.py:1391-1396`) | skips team plays | count team highlights? |
| T2 | Athlete's season ranking (Glicko pool, seeded by v009; `queries.py:152-186`) | the user's own team reels already enter it (T10070) | keep team highlights in the athlete's ranking? |
| T3 | Download intro card (`downloads.py:691-705`) | always adds the athlete's intro card | a team highlight opens with the athlete's name card: drop or swap it for team highlights? |
| T4 | Recap highlights sidebar (`games.py:1990-2015`, `RecapPlayerModal.jsx:117,348`) | doesn't split layers | split by layer? |
| T5 | Game-expiry auto-export 4-star fallback (`auto_export.py:164-171`) | fallback only when NO 5-star exists in either layer, so a team 5-star now cancels the athlete's 4-star fallback | run the fallback per layer? |

The old "My athlete only" default in `GameClipSelectorModal` goes away with the Reels removal
(T11230). Stale comment to fix: `bootstrap.py:138-141` says team reels are excluded.
Framing / Spotlight have no layer logic; copy says "Frame your athlete"
(`FramingInstructions.jsx:48-86`, `CropLayer.jsx:122`, `FocusTimeline.jsx:105`): consider
neutral wording for team highlights in the T11280 sweep.

## Related Tasks
- Depends on: T11130 (popup), owner answers T1-T5
- Knowledge doc: correct `annotate.md` to say team plays already create highlights on every path

## Acceptance Criteria

- [ ] Red-then-green: a Team play rated Highlight shows the popup and Make Highlight Now opens Frame Highlight on it
- [ ] No UI copy says team plays can't become highlights
- [ ] T1-T5 behave per the owner's answers (a test per changed rule)
