/**
 * T5410: open-play window gate (client-side mirror).
 *
 * Mirrors app/services/poster.py's open_play_window/select_poster_frame EXACTLY
 * (same constants, same arithmetic) so the overlay timeline marker's DEFAULT
 * position preview matches what export will actually pick. The backend is the
 * only authoritative selector at export time -- this is a preview default only,
 * never persisted, never sent to the server.
 */

export const SPOTLIGHT_SKIP_SECONDS = 2.0;
export const END_MARGIN_SECONDS = 0.3;
export const MIN_WINDOW_SECONDS = 0.5;

/**
 * @param {[number, number] | null} section - first slow-mo section [start, end]
 *   in final-video seconds, or null (no slow-mo).
 * @param {number} finalDuration - total duration in seconds.
 * @returns {[number, number]} the candidate poster window [start, end].
 */
export function openPlayWindow(section, finalDuration) {
  if (!section) {
    return [0, Math.max(0, finalDuration - END_MARGIN_SECONDS)];
  }
  const [start, end] = section;
  const candStart = start + SPOTLIGHT_SKIP_SECONDS;
  const candEnd = Math.min(end, finalDuration - END_MARGIN_SECONDS);
  if (candEnd - candStart < MIN_WINDOW_SECONDS) {
    return [start, end];
  }
  return [candStart, candEnd];
}

/**
 * T6630 round 8: absent a marker, default to the window's own start when
 * `section` is set (that start already IS `section.start +
 * SPOTLIGHT_SKIP_SECONDS` -- already past the contested/occluded opening
 * frames, no second push needed); otherwise (no section, window starts at
 * the clip's literal frame 0) default to 2 seconds into the window, clamped
 * to `end` so a window shorter than 2s never returns a time outside it.
 * Round 7's original "+2s into the window, always" stacked with the skip
 * above and landed ~4s past the section's start (e.g. section at 1.5s ->
 * default at 5.5s, live-reported as "6s instead of ~2s"). Mirrors
 * poster.py's select_poster_frame EXACTLY.
 *
 * @param {[number, number]} window
 * @param {number | null} userMarkerTime - honoured verbatim when set.
 * @param {[number, number] | null} section - the SAME section `window` was
 *   built from (see openPlayWindow), or null.
 * @returns {number} the poster frame's time.
 */
export function selectPosterFrame(window, userMarkerTime, section) {
  if (userMarkerTime != null) return userMarkerTime;
  const [start, end] = window;
  if (section) return start;
  return Math.min(start + 2.0, end);
}
