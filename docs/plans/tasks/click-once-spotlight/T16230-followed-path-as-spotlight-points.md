# T16230: Followed path as spotlight points

## In plain words

Today a spotlight (the circle that follows the athlete through a highlight) is stored as a few points, one for each tap the parent made, and the circle glides between them. The following engine returns something different: a box on every single frame, thirty a second, which jitters slightly and cannot be dragged by hand. This turns that path into the same kind of points the app already stores: smoothed, thinned to a handful where the athlete's movement bends, and sized to the athlete. The parent can then drag any point as they do today, and export needs no change. Done when a followed path, saved and exported, keeps the circle on the athlete as closely as the raw path did, using no more than about ten points for four seconds.

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-11-12
**Updated:** 2026-11-12
**Milestone:** Click-once Spotlight (see [EPIC.md](EPIC.md)). Task 2 of 6.

## How we got here

The app's spotlight points and the glide between them were built for hand placement: four taps across two seconds. The following engine (T16220) produces a dense path instead.

## The problem

Storing thirty boxes a second would make the timeline unusable, every correction a fight with hundreds of points, and saved projects much larger. Storing only four evenly spaced points would throw away exactly what following adds: the turns between the taps.

## What we will do

1. Smooth the path lightly so the circle does not tremble with each stride.
2. Keep a point wherever leaving it out would move the circle off the athlete by more than a set fraction of their height; drop the rest. Straight runs keep few points, sharp turns keep more.
3. Size the circle from the athlete's box the way a tap on a detected box sizes it today.
4. Mark each point as made by following, so later screens can tell them from the parent's own.
5. Carry the engine's doubtful stretches through as part of the result, for T16250 to show.
6. Save through the same path a parent's taps use, started by the parent's tap, never by the screen noticing that a result arrived.

## Why this and not something else

Reusing ordinary points means export, saving, re-editing and every correction gesture keep working with no change. A separate stored path would need all of those built a second time.

## How we will know it worked

- [ ] On the 54-clip set, the circle rebuilt from the thinned points stays on the athlete on every frame where the raw path did, on at least 45 clips.
- [ ] A four-second followed spotlight is stored as roughly ten points or fewer on a typical clip; the count is reported for the whole set.
- [ ] A followed spotlight saved, reloaded and exported shows the same circle path as before saving.
- [ ] Dragging one followed point changes only the path near it, as with a hand-placed point today.
- [ ] Points made by following can be told apart from the parent's in the saved data.

## For the implementer

### Design notes
- Small architecture note first (M tier): where thinning runs (backend, next to the job result) and the exact shape added to a keyframe. Existing keyframes already carry `fromDetection`; add a distinct marker for following rather than reusing it, because guided-pick logic counts `fromDetection` picks.
- Keyframes are `{time, x, y, radiusX, radiusY, ...}` in `highlights_data` (msgpack). No table or column change is expected; if one turns out to be needed, the task gains a migration and the Migr box in PLAN.md is ticked.
- The glide is Catmull-Rom (`_spline_interpolate_highlight` on the server, the matching frontend code in `useHighlightRegions`). Fit against that interpolation, not straight lines, so preview and export agree.
- Persistence rules: gesture-based only, surgical write of the changed region (see CLAUDE.md, Persistence).
- Evaluate thinning offline with the prototype's stored per-frame results (`out/results/sam2_base_plus.json`).

### Related Tasks
T16220 (per-frame boxes and doubtful stretches), T16240 (shows the result), T16250 (uses the doubtful stretches), T10060 and T5600 (how detection-made points are carried today).

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`
- `src/frontend/src/modes/overlay/utils/primaryDetection.js`
- `src/backend/app/modal_functions/video_processing.py` (`_spline_interpolate_highlight`, `_render_highlight`)
- `src/backend/app/routers/export/overlay.py`
- `src/backend/app/routers/detection.py`
- `.claude/knowledge/keyframes-framing.md`
- `.claude/knowledge/persistence-sync.md`
