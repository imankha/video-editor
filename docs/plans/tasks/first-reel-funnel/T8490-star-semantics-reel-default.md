# T8490: Add Play sheet: star semantics made visible (5-star reel default ALREADY EXISTS)

**Status:** STAGING
**Impact:** 7
**Complexity:** 2
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source; scope corrected)
**Updated:** 2026-09-03 (pre-flight re-read against T8600's merged strip layout, PR #322 -
badge map is now a 5-entry `RATING_NOTATION` already exported from `clipConstants.js` with
4 stale duplicate copies to consolidate, not the `{4:'!',5:'!!'}` this file originally
described; ClipDetailsEditor.jsx does not currently render the glyph at all; the caption
needs adding in 3 layout branches, not 1 - see kickoff `C:\tmp\kickoff-t8490.md` for the full
corrected spec, spawned to container reel-task-t8490)

## Problem + scope correction

The walkthrough report claimed "the Reel switch defaults to Don't Create Reel". Source
inspection shows the user's requested behavior IS ALREADY IMPLEMENTED:

`src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`:
- line 167-168: `createProject` + `createProjectManuallySet` state
- line 476-477: the rating gesture runs
  `if (!createProjectManuallySet) setCreateProject(rating === 5 && mine)` - a 5-star
  rating on a My Athlete-layer clip auto-enables Create Reel; an explicit user toggle
  (`createProjectManuallySet`) always wins; Team-layer clips never auto-enable.
- Covered by `AnnotateFullscreenOverlay.layer.test.jsx` lines 98-115 ("a 5-star My
  Athlete clip DOES auto-enable Create Reel", "switching the Layer control to Team
  after a 5-star rating turns Create Reel off").

(The walkthrough persona rated 5 stars - which auto-enabled the switch - then toggled
it twice and misread the OFF state as the default. Correct the record: behavior is
right; COMMUNICATION is the gap.)

User decision 2026-09-03 (still fully applicable): below 4 stars a play is probably not
reel-worthy; we must do a better job communicating what the stars mean and that at
5 stars the reel will be on by default.

The unexplained glyphs, also verified: `AnnotateFullscreenOverlay.jsx` lines 46-47
define the rating badge map `{ 4: '!', 5: '!!' }` - the "!" next to the stars and the
"!!" on clip cards are rating shorthand nobody explains. And the soccer tag grid
contains a tag named "Save" (`src/frontend/src/modes/annotate/constants/soccerTags.js`,
same file as "Interception" at line 44) rendered directly above the form's real Save
button.

## What to build

### Step 1 - star-scale caption (the core deliverable)

Under the rating row in the Add Play sheet (create mode) add a one-line dynamic caption
bound to the current rating (and mirroring the auto-flip logic's `mine` gate):

| State | Caption |
|---|---|
| no rating yet | "1-5: how big was this play? 5 starts a reel automatically." |
| rating 1-3 | "Saved to your library." |
| rating 4 | "Big play (!) - saved to your library." |
| rating 5 + My Athlete layer | "Can't-miss play (!!) - reel will be created." |
| rating 5 + Team layer | "Can't-miss team play (!!) - team clips don't start reels." |

Style: `text-xs text-gray-400` consistent with the sheet's existing helper lines
("You can change all of this later." lives at ~line 379 - match it). The caption is
pure derived render state - no new store state, no persistence.

Mirror the same caption in `ClipDetailsEditor.jsx`'s rating row (edit mode) with the
edit-mode phrasing (no "will be created" - the reel either exists or the control shows
the T8470 link).

### Step 2 - label the glyphs at the source

The `{4: '!', 5: '!!'}` badge map: give every render site a tooltip/aria-label
("Big play" / "Can't-miss play"). Grep for the map's usages (clip cards in the Annotate
sidebar, timeline chips, Focus clip list) - centralize the map + labels in ONE exported
constant (e.g. `RATING_BADGES` in a constants file under modes/annotate/constants/) and
import it everywhere instead of the current inline copies. Greppability rule: explicit
names, no dynamic generation.

### Step 3 - rename the "Save" tag display

In `soccerTags.js` change the DISPLAY name "Save" -> "Keeper Save". IMPORTANT: check
whether the stored tag value equals the display string (likely yes - tags are stored as
their names). If so, keep the stored value 'Save' and add a display-name mapping so
existing clips' tags still match (tagRegistry has a test file at
`modes/annotate/constants/__tests__/tagRegistry.test.js` - see how names flow, add the
displayName field there if the registry supports it, otherwise a small
`TAG_DISPLAY_NAMES` map used at render time). Do NOT migrate stored data for a label.

### Step 4 - tests

- Extend `AnnotateFullscreenOverlay.layer.test.jsx`: caption text for each state row in
  the table above (5 cases).
- Existing auto-flip tests stay green untouched (behavior unchanged).
- Tag display: a test that the grid renders "Keeper Save" while a clip tagged 'Save'
  still shows as tagged.

## Explicitly NOT in scope

- Changing the auto-flip behavior or its `mine` (layer) gate - it already matches the
  user decision.
- Any rating-threshold change (4-star does not auto-enable; user said below 4 not
  reel-worthy, and 4 was left manual by the existing design - keep).
- The sport-picker gate inside the sheet: T8140 (STAGING) already reworked sport
  selection; do not touch here.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
  (lines 46-47 badge map, 167-168 state, 476-477 auto-flip, ~379 helper-line style,
  ~498-521 reel toggle block)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` - edit-mode caption
- `src/frontend/src/modes/annotate/constants/soccerTags.js` - "Save" tag
- `src/frontend/src/modes/annotate/constants/` - new RATING_BADGES home + tagRegistry
- Tests: `AnnotateFullscreenOverlay.layer.test.jsx`, `tagRegistry.test.js`

### Related Tasks
- T8140 (STAGING) owns the sheet's form ergonomics - rebase on it, keep the caption
  from pushing Save below the fold (T8550 will assert this at 320px)
- T8470/T8480 own everything after Save

## Acceptance Criteria

- [ ] Rating caption renders per the 5-state table, in create AND edit mode
- [ ] Every "!"/"!!" render site carries a label; the map lives in one constant
- [ ] Tag grid shows "Keeper Save"; stored tag values unchanged; old clips unaffected
- [ ] Auto-flip behavior byte-identical (existing layer tests untouched and green)
- [ ] At 320x844 with the caption added, the sheet's Save stays reachable (coordinate
      with T8550's assertion)
