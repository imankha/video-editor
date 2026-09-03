# T8490: Add Play sheet: star semantics + 5-star reel default

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

Walkthrough 2026-09-02, Add Play sheet findings:

1. The Reel switch defaults to "Don't Create Reel" regardless of rating. A parent who
   saves without noticing gets a clip that goes nowhere (the exact mostafaali /
   cschwartz78 zero-output shape from the prod drop-off data).
2. Nothing explains what the stars MEAN. The rating row ends in an unlabeled "!" glyph.
3. The tag grid contains a tag literally named "Save" (goalkeeper save) in the same
   panel as the form's real Save button.

User decision 2026-09-03: reel on-by-default globally is REJECTED. A play rated below
4 stars is probably not reel-worthy. Instead: communicate what the stars mean, and at
5 stars the Reel toggle defaults ON.

## Solution

- Rating-driven default: when the user sets 5 stars, the Reel switch flips ON (with the
  label updating so the change is visible); below 5 it stays wherever the user put it,
  default OFF. A user can always override after the auto-flip; an explicit user gesture
  on the switch wins over subsequent rating changes within the same sheet.
- Star semantics made visible: caption under the rating row explaining the scale in
  parent language (e.g. 5 = reel-worthy, must-see; 3 = good moment for the library), and
  the "!" glyph gets a label or is folded into that caption. Investigate what "!" renders
  today (it also appears as "!!" on clip cards) and either label it or replace it with
  the star count.
- Rename the "Save" tag to "Keeper Save" (UI string only, keep the stored tag value for
  greppability/back-compat; reconcile with the sport tag definitions source).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - Add Play sheet (rating row, reel switch, ~line 379 area)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` - same controls in the details panel
- Sport/tag definitions module (locate: grep for 'Keeper' / tag lists; likely a constants file per sport)
- Tests: `AnnotateFullscreenOverlay.layer.test.jsx` + new rating-default tests

### Related Tasks
- T8140 (one-tap first clip, STAGING) already reworked form defaults; rebase on it
- T8470/T8480 own what happens after save

### Technical Notes
The auto-flip is in-sheet UI state, not a persisted preference: no new backend write, no
reactive effect. Implement as part of the rating gesture handler (set rating -> maybe set
switch), never as a useEffect watching rating state.

## Implementation

### Steps
1. [ ] Find what "!"/"!!" renders and decide label vs replace (with ui-designer input if ambiguous)
2. [ ] Rating gesture: 5 stars flips Reel ON unless the user explicitly set the switch this session
3. [ ] Star-scale caption + switch label states ("Create Reel" / "Don't Create Reel") stay honest
4. [ ] "Save" tag renders as "Keeper Save"
5. [ ] Unit tests: default matrix (rating x explicit-override), tag label
6. [ ] e2e: rate 5 -> save -> reel exists; rate 3 -> save -> no reel, no surprise

## Acceptance Criteria

- [ ] 5-star rating defaults the Reel switch ON, visibly; explicit user choice always wins
- [ ] Below 5 stars nothing auto-flips
- [ ] Star meaning is explained on the sheet; no unlabeled glyphs remain
- [ ] No tag shares a name with a form action
- [ ] Verified at 390x844 (rating caption must not push Save below the fold; see T8550)
