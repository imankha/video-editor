# T17650: Trim control blocks deleting split

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A parent splits a play and trims its last section. The control that restores the trimmed end sits over Delete split. Clicking Delete split cannot reach that button, so the parent must restore the trimmed section before removing the split. This repeated on all three fresh page loads. The two controls should both remain reachable.

## How we got here

Found by the full QA continuation on 2026-11-18 on staging, build ce8988c54 (#8063), as e2e@test.local, desktop 1440 x 900. This is the returning parent flow.

## Repro steps

1. On staging, open Frame for a play of about eight seconds. The evidence uses the QA game qa18-game, play14, with a 7.5 second marked range.
2. Click Trim and slow motion.
3. Click about 70 percent across the single Normal speed section to split it.
4. Click Trim section on the last section.
5. Hover the split and try to click Delete split.

**Expected:** The split can be removed without first restoring the trimmed footage.
**Actual:** Undo end trim covers Delete split and receives the pointer input instead.
**Repeats:** 3 of 3 fresh page loads, waiting for each save response before reloading.
**Also checked at:** Other device classes not yet checked for this exact interaction. Layout-only screenshots exist at all supported sizes.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-18/bugs/B02-trim-repro1.png` through `B02-trim-repro3.png` (local, not in git).
- Logs and geometry: `qa/qa-pass-2026-11-18/bugs/B02-logs.json` (local, not in git).
- The Delete split button occupies x965 to989, y781 to805. Hit-testing its center returns Undo end trim (2.3s trimmed).
- Console: no exception established as the cause of this visual overlap.
- Network: relevant POST /api/clips/projects/14/clips/14/actions requests returned 200. No failing request established for the overlap.
- Server log: no server-side failure established; this is a visible input obstruction.

## Solution

Both the trim restore control and Delete split remain visible and separately reachable after an end section is trimmed.

## Relevant Files

Found by searching for the on-screen Delete split label:

- `src/frontend/src/components/timeline/RegionLayer.jsx`
- `src/frontend/src/modes/focus/layers/SegmentLayer.jsx`

## Acceptance Criteria

- [ ] C1: The steps above allow deleting the split while keeping the end trimmed at 1440 x 900.
- [ ] C2: The same interaction remains reachable on phone and tablet touch layouts.
