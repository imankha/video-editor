// T5225 -- pure snapping math for the Overlay text layer's range levers.
//
// Design: docs/plans/tasks/T5225-design.md §3.2 (epic decision 4). Free drag
// that SNAPS to clip boundaries within a PIXEL threshold, converted to time at
// drag time (zoom-invariant), mirroring RegionLayer.jsx's existing 15px
// click-to-add snap. Decoupled from any DOM/pointer plumbing so it's trivially
// unit-testable and shareable (TextLayer today; RegionLayer could adopt it
// later without duplicating the math).

/**
 * Snap `rawTime` to the nearest candidate boundary if it's within `thresholdPx`
 * (converted to a time delta via `pxPerSecond`); otherwise return `rawTime`
 * unchanged (free park -- "the first 3 seconds mid-clip" stays expressible).
 *
 * @param {number} rawTime - the raw computed time under the pointer (seconds).
 * @param {number[]} boundaries - candidate snap targets (seconds), e.g.
 *   [0, ...clip_boundaries, totalDuration].
 * @param {number} thresholdPx - snap radius in PIXELS (e.g. 10).
 * @param {number} pxPerSecond - the track's current px-per-second scale.
 * @returns {number} the snapped boundary time, or `rawTime` unchanged.
 */
export function snapToBoundary(rawTime, boundaries, thresholdPx, pxPerSecond) {
  if (!boundaries || boundaries.length === 0) {
    return rawTime;
  }

  const thresholdSeconds = thresholdPx / pxPerSecond;

  let nearest = null;
  let nearestDelta = Infinity;
  for (const boundary of boundaries) {
    const delta = Math.abs(rawTime - boundary);
    if (delta < nearestDelta) {
      nearest = boundary;
      nearestDelta = delta;
    }
  }

  if (nearest !== null && nearestDelta <= thresholdSeconds) {
    return nearest;
  }
  return rawTime;
}

export default snapToBoundary;
