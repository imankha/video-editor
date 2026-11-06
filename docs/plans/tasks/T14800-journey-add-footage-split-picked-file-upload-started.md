# T14800: Journey: split "Add footage" so the biggest loss says why (never picked a file vs upload died)

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

The prod Journey map (2026-11-03, 14d window, all platforms) ranks **Add footage** as the
largest loss in the whole funnel: 277 reached, **100 lost (0 still visiting, 100 gone)**, 21 in
window. That is 36% of everyone who opened the upload screen, and more users than any other
stage loses. Today the stage cannot say why, because one stage covers three different outcomes:

1. opened the upload modal and never picked a file (`add_game_opened` only);
2. picked a file and the upload never started, or was attempted and died
   (`upload_file_selected`, `game_created`, maybe `game_upload_failed:{reason}`);
3. the upload is still running or finished after the window (`game_upload_succeeded` later).

The ladder (`JOURNEY_LADDER` in `src/backend/app/analytics.py`) has one node for
`add_game_opened | add_clip_opened` and the next node is `game_upload_succeeded |
clip_uploaded`. The events that would separate the three outcomes already exist and have been
recorded since 2026-08-28 (`upload_file_selected`, `game_created` since 2026-05-20), so no new
beacon is needed.

Why this matters for prioritising: a "never picked a file" loss is a product/expectation
problem (no footage on this device, wrong device, did not know where to get the Veo file,
T14810). An "upload died" loss is a reliability problem (phone backgrounded, multi-GB file on
cellular, server-side failure; T9000, T447, T10270). Those are different fixes with different
owners, and today they are one number.

## Solution

Add two ladder stages between **Add footage** and **Footage landed**, both non-major (they
collapse into the existing gap chip by default, T14010 progressive disclosure):

| key | label | actions | instrumented since |
|---|---|---|---|
| `file_picked` | Picked a file | `upload_file_selected` | 2026-08-28 |
| `upload_started` | Upload started | `game_created` | 2026-05-20 (attempt row, T7510) |

The loss ranking then reports "Add footage N lost" (opened, never picked), "Picked a file N
lost" (picked, never started), "Upload started N lost" (started, never succeeded), each with
its own stuck/gone split and inspector (exit screen, failure reasons from
`game_upload_failed:{reason}`).

Keys are frozen once shipped (T14720 renames labels only). The `clip_uploaded` direct-upload
path has no file-picked/attempt events; those users skip the two new stages, which T14720's
implied-reach rule handles (reaching Footage landed implies the earlier stages).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - `JOURNEY_LADDER`, `EVENT_INSTRUMENTED_AT` (add the two stages; confirm the two dates with `git log -S`)
- `src/backend/app/services/analytics_journey.py` - `fold_journey` / `classify_user` (ladder length is data-driven; verify nothing hard-codes 14)
- `src/frontend/src/components/admin/JourneyFlowChart.jsx` - gap chip count ("+n stages") derives from the ladder; no label hard-coding
- `src/frontend/src/components/admin/journeyFold.test.js`, `JourneyTab.test.jsx`, `StepInspector.test.jsx` - fixtures that enumerate stage keys
- `src/backend/tests/test_analytics_journey.py` (or the file that owns the conservation test) - reached = continued + in_window + stuck + gone must still hold with 16 stages

### Related Tasks
- Depends on: nothing. Do it before or with T14720 (implied reach); if T14720 lands first, add the stages under its rule.
- Blocks: the Add footage root-cause reading that decides between T14810 (no-file path) and T9000 / T447 (upload reliability).
- Related: T14710 (missing Frame export events), T14740 (click a loss to list users), T7510 (attempt/outcome pair), T10270 (durable upload-failure record).

### Technical Notes
- `game_created` is the pending insert (attempt), not success: that is exactly what makes it the right "Upload started" signal (T7510 comment in `FUNNEL_STEPS`).
- Keep both new stages `major: False` so the default map still shows the five majors.
- Partial badges: a user who signed up before 2026-08-28 cannot have `upload_file_selected`; the existing `partial_from` badge handles it, so no special case.

## Implementation

### Steps
1. [ ] Add the two stage dicts to `JOURNEY_LADDER` in ladder order; add their `EVENT_INSTRUMENTED_AT` dates (verify with `git log -S "upload_file_selected"` and `-S "game_created"` on the recording sites).
2. [ ] Run the journey fold/classify unit tests; fix any fixture that enumerates stage keys by position.
3. [ ] Frontend: confirm the collapsed gap chip reads "+5 stages" between Signed up and Clipped and that expanding shows the two new nodes with their ribbons; update the admin tests.
4. [ ] Dev check with the `full` dev preset plus one fresh `empty` account that opens the upload modal and closes it: the loss ranking must put that account at "Add footage", not "Picked a file".
5. [ ] Record in this file the prod reading after deploy: lost at Add footage vs Picked a file vs Upload started.

### Progress Log

**2026-11-03**: Filed from the funnel walk + prod journey screenshot. Not started.

## Acceptance Criteria

- [ ] Loss ranking shows three separate rows for opened / picked / started, each with stuck and gone counts.
- [ ] Conservation test passes with the longer ladder; stage counts never increase along the ladder once T14720 is in.
- [ ] No new event is emitted; only existing `user_actions` rows are read.
- [ ] Tests pass.
