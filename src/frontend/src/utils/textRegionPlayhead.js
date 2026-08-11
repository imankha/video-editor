/**
 * Shared "is this text region active under the playhead" predicate (T6880).
 *
 * TWO surfaces decide whether a text region is live at the current playhead:
 *   - the CANVAS burn-in preview (TextOverlayPreview.jsx), and
 *   - the Text SETTINGS panel's region list (OverlayModeView.jsx).
 * They MUST agree by construction, or the user sees text on the video while the
 * panel says "No text region under the playhead" (the T6880 report). They
 * diverged because each re-implemented the range test on its own -- and the
 * canvas additionally layered a SELECTED-region exception on top, so it kept
 * rendering an out-of-range region the panel had already dropped.
 *
 * This is the ONE predicate both import. The half-open `[startTime, endTime)`
 * convention (design O6) matches text_render.py's strict burn-in windows, so
 * preview == export. The editing-ghost exception (a selected region shown while
 * you edit it with the playhead nudged outside) is layered EXPLICITLY on top of
 * this in TextOverlayPreview -- it is NOT part of "under the playhead".
 *
 * EPSILON: a programmatic seek to `region.startTime` can land React's
 * `currentTime` a hair (sub-millisecond, observed ~7e-7s) BELOW startTime -- the
 * video element's reported currentTime after a seek is not bit-identical to the
 * requested value. Without tolerance a just-created/just-selected region's own
 * settings would stay hidden forever once paused (currentTime never moves
 * again). EPSILON is far below one video frame (~0.033s at 30fps), so it cannot
 * widen "the playhead is over this region" into any perceptible range. (T6630
 * round 7 item 1 established this on the panel side; T6880 shares it.)
 */
export const PLAYHEAD_EPSILON = 0.01;

/** True when `currentTime` falls in this region's half-open range (± EPSILON). */
export function isRegionUnderPlayhead(region, currentTime) {
  return (
    region.startTime - PLAYHEAD_EPSILON <= currentTime &&
    currentTime < region.endTime + PLAYHEAD_EPSILON
  );
}
