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
 * COMPARED AS STRINGS ON PURPOSE. `selectedProjectId` is not reliably numeric:
 * the auth-return and payment-return paths read it back out of `sessionStorage`
 * (`authStore.js`, `BuyCreditsModal.jsx`) and `projectsStore.selectProject`
 * stores that argument verbatim, so `projectId` can arrive here as `"41"` while
 * every clip row carries a numeric `project_id` (required on
 * `WorkingClipResponse`). A strict `!==` would then call EVERY clip foreign and
 * leave Focus permanently blank on those paths — and blank crop hooks are what
 * the payment path's auto-export would persist. This guard must fail OPEN on a
 * type mismatch (pre-fix behavior, a transient wrong request) rather than CLOSED
 * (no video at all, and it never heals). The ids are coerced at their
 * sessionStorage boundary too, but the catastrophic failure mode lives here, so
 * this is the half that must be tolerant.
 *
 * @param {{project_id?: number|null}} clip - a working-clip row
 * @param {number|string|null|undefined} projectId - the project the screen is showing
 * @returns {boolean} true => ignore this clip and wait for the fresh list
 */
export function isClipFromAnotherProject(clip, projectId) {
  if (!clip || clip.project_id == null || projectId == null) return false;
  return String(clip.project_id) !== String(projectId);
}

/**
 * After a `playback-url` request, should the caller fall back to the `/stream`
 * proxy?
 *
 * ONLY 404 suppresses the fallback, because 404 is the one status both endpoints
 * provably agree on: they run the IDENTICAL row query
 * (`WHERE wc.id = ? AND wc.project_id = ?`, `clips.py` in both
 * `get_clip_playback_url` and `stream_working_clip_bounded`), so a 404 from one
 * is a guaranteed 404 from the other. Retrying it only converts an internal bug
 * into a dead `<video>` src that the player mislabels as an expired source — the
 * exact masking this task removes, per CLAUDE.md "No silent fallbacks for
 * internal data".
 *
 * A blanket "no fallback on any 4xx" would be WRONG, and 422 is the live proof:
 * `get_clip_playback_url` raises 422 when the game video has no blake3 hash,
 * BEFORE presigning, while `/stream` has no such check and `get_game_video_url`
 * falls back to the pre-T80 per-user `{user}/games/{filename}` storage for
 * exactly that case. The clips list still populates `game_video_url` for those
 * rows (`if blake3 or clip['game_video_filename']`), so for a legacy
 * blake3-less game the proxy is the path that actually works. Do not widen this
 * to all 4xx without first proving no such videos remain in dev/staging/prod.
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
  return status !== 404;
}
