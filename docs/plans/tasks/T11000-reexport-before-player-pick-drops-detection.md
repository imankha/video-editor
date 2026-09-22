# T11000: Framing re-export before picking a player dropped all tracking (0 regions)

**Status:** DONE (deployed 2026-09-21 prod)
**Impact:** 8
**Complexity:** 1
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Report (imankh@gmail.com, prod, 2026-09-21)

"I just exported from framing on prod and I didn't get player tracking." Spotlight opened with
no highlight region and no green detection markers on the timeline; `[Overlay Data] project=3:
0 regions, 0 detection boxes`.

## Root cause (prod DB replayed locally)

Project 3 ("Great Moves and Pass") had two Framing exports that night:

1. 04:32, working video 3: detection ran, one seeded region (`region-auto-0-0`, 0-2 s,
   `keyframes: []`, 4 detection samples). The user did not click a player.
2. 04:40, working video 4 (two slow-mo segments added): detection ran again (`detections_data`
   5.4 KB), but `highlights_data` was an EMPTY list with `highlight_carry_note = dropped:1`.

`resolve_carried_highlights` (T4350) saw a non-empty prior, the framing differed, so it took the
single-clip transform path. `transform_highlight_region_to_raw` returns `None` for any region with
no keyframes (`highlight_transform.py`, "if not raw_keyframes: return None"), so the seeded region
was "dropped", and by design (T4350 Q5) detection output never replaces a carried region. Result:
zero regions, and the fresh detection that had just run was discarded. Any re-export made before
the user picks a player hit this.

## Fix

`highlight_carry.py`: Rule 1 ("first export -> seed from detection") now triggers when NO prior
region has a keyframe (`_has_user_geometry`), not only when the list is empty. A keyframe-less
seed carries no user geometry, so there is nothing for detection to overwrite; once any region has
a placed spotlight the transform path runs exactly as before (guard test added).

## Verification

- `pytest tests/test_t4350_highlight_carry.py tests/test_t4350_carry_finalize.py tests/test_t4355_multiclip_carry.py` -> 37 passed (2 new: the prod replay shape, and the placed-region guard).
- Replayed the real prod snapshots + prior region through the fixed function: 1 seeded region, no note (was 0 regions, `dropped:1`).

## Data note

Working video 4 on prod still holds the empty `highlights_data`; the fix only applies to the next
export. Its `detections_data` cache is intact, so the seeded region could be rebuilt without a
re-render if the user prefers that to re-exporting.
