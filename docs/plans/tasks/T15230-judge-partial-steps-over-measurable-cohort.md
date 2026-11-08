# T15230: Judge partial Journey steps over the sign-ups that can be measured

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Tier:** M (backend + frontend, read only, no schema change)
**Created:** 2026-11-06
**Updated:** 2026-11-06

Owner request 2026-11-06, the follow-up to T14900 and T14920.

## Problem

A Journey step is partial when either end's event was instrumented after the window starts
(`annotate_coverage`, `EVENT_INSTRUMENTED_AT`). With no date filter the window starts at the
earliest sign-up, so one old sign-up marks a whole step partial, even though most users can be
measured. `export_started` and `export_completed` date from 2026-11-04, so the export steps are
partial on any view with older sign-ups, and `game_upload_succeeded` (2026-08-26) does the same to
the upload step.

A partial step gets no colour and cannot be the biggest leak. After T14900 and T14920 this is
honest but incomplete:

- Next Step reads "Biggest judged leak" and warns "Any of these could be larger", yet the real leak
  can stay unnamed and "Next" can go to a smaller one. In the seeded check the panel named 67 lost
  while the loss strip showed the upload step losing 90.
- A collapsed group holding a partial step goes grey, even when another step in it is red.

## Solution

Judge each step over the sign-ups acquired on or after the later instrumentation date of its two
ends, not over the whole window. The step then gets a real rate, colour and loss count for that
cohort, labelled with its start: "71.00% of 212 since 2026-08-26". A step stays partial only when
that cohort is under the small-N floor or empty.

Design question to settle first: the map's counts conserve across stages, and a step measured over
a narrower cohort will not add up with its neighbours. Decide where the measured-cohort rate shows
(marks and chips, not node counts is the likely answer) and how `biggestLeak` compares steps judged
over different cohorts (users lost favours the step with the older start date).

## Ruling

Owner approved 2026-11-07 (decision page, decision 3, option B):

- The cohort rate shows on edge labels, the inspector chip and the Next Step row ("71.00% of 212
  since 2026-08-26"). Node counts are unchanged and keep conserving.
- `biggestLeak` ranks by projected loss: the step's cohort loss rate times the users entering the
  step in the selected window (node counts). The row reads "about 156 lost (projected from 18 of 30
  since 2026-11-04)". Only cohorts at or above the small-N floor are ranked; a step under the floor
  stays partial and unranked.

## Context

### Relevant Files (REQUIRED)

- `src/backend/app/services/analytics_journey.py` (`annotate_coverage`, `build_journey`)
- `src/backend/app/analytics.py` (`EVENT_INSTRUMENTED_AT`, `JOURNEY_LADDER`)
- `src/frontend/src/components/admin/journeyTargets.js` (`measure`, `foldedMark`)
- `src/frontend/src/components/admin/NextStepPanel.jsx` (`biggestLeak`, the row wording)

### Related Tasks

- T14900, T14920: the honest labelling this replaces.
- T14910: the spend gates use their own cohort reads and are not affected.

## Acceptance Criteria

- [ ] A step with a partial end shows a rate, colour and loss count over the sign-ups since its
      later instrumentation date, and prints that date.
- [ ] A step stays partial only when that cohort is under the floor or empty, never because of one
      old sign-up.
- [ ] Next Step names the real biggest leak on a view whose earliest sign-up predates an event, with
      the comparison across cohorts stated.
- [ ] Node counts on the map still conserve.
- [ ] Red-to-green tests on the seeded windows from the T14900 verification (2026-03-04 and
      2026-08-16 earliest sign-ups).
