/**
 * T10740: the two decisions `FocusScreen.getClipVideoConfig` makes before it
 * hands a URL to `<video>`. Pure so they can be pinned by unit tests (same
 * pattern as `focusOverlayTransition.js`).
 *
 * Both exist because of one live bug: Annotate "Frame Later" -> "Frame" opened
 * Focus on a FALSE "This video is no longer available. Its source storage may
 * have expired." Nothing had expired and nothing was un-ready — Focus asked the
 * backend for the PREVIOUS project's clip id under the NEW project's id, got an
 * honest 404, silently re-tried the `/stream` proxy with the same impossible
 * pair, and handed that dead URL to the player, which reported it as expiry.
 */

/**
 * Is this clip row left over from a DIFFERENT project than the screen showing it?
 *
 * `App.handleModeChange` fires `invalidateClips` fire-and-forget and switches
 * editor mode immediately; `projectDataStore.fetchClips` only writes `clips`
 * when the response lands and never clears the previous list (`clearClips`
 * exists but is not called on this path). So for that window `FocusScreen`
 * renders the new `projectId` over the old project's `clips`/`selectedClipId`,
 * and its `[]`-deps mount loader fires on them immediately.
 *
 * Pairing those ids is not merely stale, it is IMPOSSIBLE: the backend matches
 * `WHERE wc.id = ? AND wc.project_id = ?` (`clips.py`), so the request can only
 * 404. The identity needed to detect this is already in the data —
 * `WorkingClipResponse.project_id` is a required field — so no new store state
 * or `clipsProjectId` bookkeeping is warranted (no-redundant-state).
 *
 * A clip carrying no `project_id` (older cached shape, hand-built test fixture)
 * is NOT treated as foreign: this guard exists to catch a known mismatch, not
 * to gate on the absence of a field. Callers keep their previous behavior there.
 *
 * @param {{project_id?: number|null}} clip - a working-clip row
 * @param {number|string|null|undefined} projectId - the project the screen is showing
 * @returns {boolean} true => ignore this clip and wait for the fresh list
 */
export function isClipFromAnotherProject(clip, projectId) {
  if (!clip || clip.project_id == null || projectId == null) return false;
  return clip.project_id !== projectId;
}

/**
 * After a `playback-url` request, should the caller fall back to the `/stream`
 * proxy?
 *
 * The fallback is for TRANSPORT failures — a dropped connection, or a 5xx where
 * the proxy is a genuinely different code path worth trying. A 4xx is our own
 * endpoint rejecting the (project_id, clip_id) pair we sent: the proxy resolves
 * the SAME pair (`clips.py` `/stream`) and fails identically, so retrying it
 * only converts an internal bug into a dead `<video>` src that the player
 * mislabels as an expired source. Per CLAUDE.md "No silent fallbacks for
 * internal data", that case must fail loudly instead.
 *
 * 410 `source_expired` never reaches here — `getClipVideoConfig` handles it
 * earlier and renders the deliberate T8310 expired panel.
 *
 * @param {number|null|undefined} status - HTTP status, or null/undefined when
 *   the request threw (network error) and there is no response at all
 * @returns {boolean} true => try the proxy; false => fail loudly with no URL
 */
export function shouldRetryClipVideoViaProxy(status) {
  if (status == null) return true; // threw before a response — transport failure
  return !(status >= 400 && status < 500);
}
