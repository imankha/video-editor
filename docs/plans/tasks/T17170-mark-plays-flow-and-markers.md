# T17170: Mark plays: next play, row taps, star markers

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

After a parent marks the first play, "Mark play" disappears and stays gone while the play stays selected, even when the video plays on past it, so the parent cannot mark the next moment. The coach also says to mark plays when the athlete "does something great", but parents should mark learning moments too. In the plays list only a small button jumps to a play, and plays are marked with chess symbols ("!", "!!", "!?") that parents do not read as ratings. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U01, U12, U09), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Deselect the play as soon as the playhead leaves its range (playing or scrubbing), so "Mark play" comes back at once. Never deselect while the play editor is open.
- Coach and copy in `src/frontend/src/config/displayNames.js`: `GUIDE.annotate.watch` becomes "Tap Play to watch the game. Tap Mark play at any moment worth keeping, a great play or one to learn from."; `watchPlaying` becomes "See a play worth keeping? Tap Mark play."; `MODE_DESCRIPTION` becomes "Mark plays: tap Mark play right after a moment worth keeping."; the upload window line "You mark the best plays..." becomes "You mark the plays and frame your athlete...". Leave "turn your best play into a highlight" as is.
- Plays list: the whole row (at least 44px high) jumps to and selects the play; the info button keeps its own action; remove the separate green play button.
- Rating markers: replace the chess glyphs with the star count on the same colored badge (keep `RATING_BADGE_COLORS`; dark text on gold for 5 stars). List row: 28px badge "4★", 13px bold, aria-label "4 stars". Timeline marker at phone size: 20px colored dot with the digit only; add the star when selected or 28px or wider. Unrated stays neutral grey with no number. Retire `RATING_NOTATION` everywhere, including the ranking game and share pages.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: At 390x844, after Done on a first play, playing past it shows "Mark play" within a second, without tapping the timeline.
- [ ] C2: No coach sentence or label says plays are only for "great" moments; the four strings above read as written.
- [ ] C3: Tapping anywhere on a plays-list row selects that play; no chess symbols remain anywhere; markers keep their colors.
