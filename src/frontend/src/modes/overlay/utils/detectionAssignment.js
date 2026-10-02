/**
 * Detection-frame assignment helpers (quest_3 "Pick Your Player").
 *
 * The step completes only when EVERY detected frame (the green markers on the
 * timeline) has had a player assigned — not just one marker per region. A
 * detection frame counts as assigned when its region has a user (non-boundary)
 * keyframe at that frame's time.
 *
 * Keyframes are stored in 30fps frame-space (see useHighlightRegions, where
 * `framerate = 30`), while detections carry a `timestamp` in seconds — so the
 * comparison is done in time-space.
 */

const KEYFRAME_FRAMERATE = 30;

// ~MIN_KEYFRAME_DISTANCE_FRAMES (5) at 30fps. A keyframe this close to a
// detection's timestamp is treated as that detection's assignment, which
// absorbs the rounding from time -> frame -> time conversion.
export const ASSIGN_TOLERANCE_S = 5 / KEYFRAME_FRAMERATE;

/** Detections that actually have player boxes — only these render as markers. */
export function detectableDetections(region) {
  return (region?.detections || []).filter((d) => d.boxes?.length > 0);
}

/**
 * True when `region` has a user keyframe at `detection`'s time.
 *
 * First and last keyframes are permanent region boundaries (scaffolding), so
 * they're normally ignored. BUT when a detection frame sits on the region's
 * first/last frame, assigning a player there updates the boundary keyframe in
 * place — it never becomes a separate middle keyframe. Such an explicitly
 * assigned boundary carries `fromDetection`, so it must still count (otherwise
 * the edge markers can never be checked off). `extraTime` lets a caller count
 * an assignment made in the same gesture, before its keyframe has landed in
 * region state (setRegions is async, so the just-added keyframe isn't visible
 * synchronously).
 */
export function isDetectionAssigned(region, detection, extraTime = null) {
  const t = detection.timestamp;
  if (extraTime != null && Math.abs(extraTime - t) <= ASSIGN_TOLERANCE_S) return true;

  const kfs = region?.keyframes || [];
  return kfs.some((kf, idx) => {
    const isBoundary = idx === 0 || idx === kfs.length - 1;
    // Unassigned boundary scaffolding doesn't count; an assigned boundary does.
    if (isBoundary && !kf.fromDetection) return false;
    return Math.abs(kf.frame / KEYFRAME_FRAMERATE - t) <= ASSIGN_TOLERANCE_S;
  });
}

/**
 * Single ordering source for every detection marker, sorted by timeline
 * position (region start, then detection time within the region). The Nth
 * entry IS the Nth marker left-to-right on the timeline — every consumer
 * that needs "marker order" (assignment states, guided-pick step numbers,
 * forward/wrap navigation) derives from this ONE list so they can never
 * disagree on what "marker N" means.
 *
 * @param {Array} regions - highlight regions (with keyframes + detections)
 * @returns {Array<{regionId: string, region: Object, detection: Object}>}
 */
export function orderedDetectionMarkers(regions) {
  const ordered = [...(regions || [])].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  const markers = [];
  for (const region of ordered) {
    const dets = [...detectableDetections(region)].sort((a, b) => a.timestamp - b.timestamp);
    for (const detection of dets) {
      markers.push({ regionId: region.id, region, detection });
    }
  }
  return markers;
}

/**
 * Ordered assignment state for every detection frame — see
 * `orderedDetectionMarkers` for the ordering rule. A `false` in the middle
 * reveals exactly which marker the user skipped.
 *
 * @param {Array} regions - highlight regions (with keyframes + detections)
 * @param {{regionId: string, time: number}|null} justAssigned - an assignment
 *   made in the current gesture, not yet reflected in `regions`.
 * @returns {boolean[]} assigned flags in timeline order
 */
export function detectionAssignmentStates(regions, justAssigned = null) {
  return orderedDetectionMarkers(regions).map(({ region, detection }) => {
    const extraTime =
      justAssigned && region.id === justAssigned.regionId ? justAssigned.time : null;
    return isDetectionAssigned(region, detection, extraTime);
  });
}

/**
 * The next UNPICKED marker after `fromIndex` in `orderedDetectionMarkers`
 * order, wrapping to the start — the guided-pick walk's single navigation
 * primitive (entry-park uses `fromIndex = -1` to start at marker 0).
 *
 * @param {Array} regions - highlight regions (with keyframes + detections)
 * @param {number} fromIndex - index of the marker just picked, or -1 to find
 *   the first unpicked marker from the start
 * @param {{regionId: string, time: number}|null} justAssigned - an assignment
 *   made in the current gesture, not yet reflected in `regions` — lets the
 *   marker just picked count as assigned immediately so the walk advances
 *   past it instead of re-parking on it.
 * @returns {{index: number, regionId: string, region: Object, detection: Object}|null}
 *   the next unpicked marker (region included so a caller can park on it —
 *   e.g. its fps/videoWidth/videoHeight), or null once every marker is
 *   assigned (or there are none at all) — the walk is done.
 */
export function nextUnpickedMarker(regions, fromIndex = -1, justAssigned = null) {
  const markers = orderedDetectionMarkers(regions);
  if (!markers.length) return null;
  for (let step = 1; step <= markers.length; step++) {
    const idx = (fromIndex + step) % markers.length;
    const { region, detection } = markers[idx];
    const extraTime =
      justAssigned && region.id === justAssigned.regionId ? justAssigned.time : null;
    if (!isDetectionAssigned(region, detection, extraTime)) {
      return { index: idx, regionId: region.id, region, detection };
    }
  }
  return null;
}

/**
 * Count assigned vs total detection frames across all regions.
 *
 * @param {Array} regions - highlight regions (with keyframes + detections)
 * @param {{regionId: string, time: number}|null} justAssigned - an assignment
 *   made in the current gesture, not yet reflected in `regions`.
 * @returns {{ total: number, assigned: number }}
 */
export function countDetectionAssignments(regions, justAssigned = null) {
  const states = detectionAssignmentStates(regions, justAssigned);
  return { total: states.length, assigned: states.filter(Boolean).length };
}
