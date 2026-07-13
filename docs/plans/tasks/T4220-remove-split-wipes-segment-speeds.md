# T4220: remove_segment_split Wipes ALL Segment Speeds

**Status:** DONE
**Impact:** 7
**Complexity:** 2
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) item A3)

## Problem

**Exposure: framing editing = core retention loop; slow-motion is a headline editing feature.**

Removing ANY segment split silently resets EVERY slow-motion speed on the clip to 1x in the DB. The user set 0.5x on segments 1 and 3, removes an unrelated split, and all speeds are gone. Worse, the hook state still shows the speeds until reload — so the DB and the screen disagree, and depending on what happens next (export PUT resurrects hook state, or reload reveals the loss) the user gets inconsistent results.

## Root Cause (verified)

`src/backend/app/routers/clips.py:483-497`, the `remove_segment_split` action handler:

```python
# Rebuild speeds dict with updated indices
# (This is complex - for now just clear speeds)
segments_data['segmentSpeeds'] = {}
```

A punted TODO shipped to prod.

## Solution

Re-index instead of clearing. Semantics to implement (also add these as a comment in the code):

- `boundaries` here is the **splits-only** list (no 0/duration — see the dual-format note below). Let `k` = index of the removed split within the sorted splits list (0-based).
- Split `k` separated segment `k` from segment `k+1`; removing it merges them into one segment at index `k`.
- New `segmentSpeeds` (keys are STRING indices in the stored dict):
  - `i < k` → keep `speeds[i]`
  - merged segment `k` → if `speeds.get(k) == speeds.get(k+1)`, keep that value; otherwise **omit the key** (merged segment plays at 1x — deterministic, no guessing which side wins)
  - `i > k+1` → becomes `speeds[i]` under key `i-1`
- Missing keys mean 1x throughout; only write keys for non-default speeds (match existing convention — check how `set_segment_speed` stores them at `clips.py:499+`).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/clips.py` — the action handler
- `src/backend/tests/` — find the existing framing-action tests and extend them

### Technical Notes
- **segments_data dual format (important):** boundaries can be splits-only (gesture path) or full-list `[0, ...splits, duration]` (export PUT path). In THIS handler you're on the gesture path (splits-only), but write the test data both ways if the handler can receive either — check `canonicalize_segments_data` usage first. See memory note "segments_data dual format".
- Frontend `useSegments` maintains its own speeds on split-removal — after fixing the backend, verify the frontend's own merge behavior matches these semantics (same gesture, same result). If it differs, align the FRONTEND to the backend rule above; do not introduce a third behavior. Frontend: `src/frontend/src/modes/framing/hooks/useSegments.js`.

## Implementation

### Steps
1. [ ] Test first: clip with splits at [10, 20, 30] and speeds {"0": 1, "1": 0.5, "3": 0.25}; remove split 20; assert speeds become {"0": 1, "1": 0.5, "2": 0.25}... wait — work the example by hand in the test comments so the next reader can follow the index math. Cover: remove first split, last split, split between two same-speed segments, split between two different-speed segments.
2. [ ] Implement re-indexing in the handler; delete the punt comment.
3. [ ] Check `useSegments.js` split-removal keeps hook state consistent with the new backend rule; add/adjust a frontend unit test if its behavior changes.
4. [ ] `python -c "from app.main import app"` + backend tests + affected frontend tests.

## Acceptance Criteria

- [ ] Removing a split preserves all unrelated segment speeds with correctly shifted indices
- [ ] Merged segment behavior is deterministic and documented in code
- [ ] Frontend and backend produce the same post-removal speeds for the same gesture
- [ ] Tests cover first/last/middle-split removal and same-vs-different-speed merges
