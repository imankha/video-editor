import { API_BASE } from '../config';

/**
 * T4000 — Parallelize the game video fetch with `/load`.
 *
 * Opening a saved game used to be two sequential round-trips: the `<video>` src
 * was set from `/load`'s presigned `playback_url`, so the byte fetch couldn't
 * begin until `/load` returned. These helpers let the container set the src from
 * a stable, gameId-only URL at click time — before `/load` — so the video fetch
 * overlaps `/load` instead of being gated by it.
 */

/**
 * Build the stable, gameId-only first-paint video src.
 *
 * Resolves to `/api/games/{id}/video` (302 → direct R2), which serves
 * `sequence=1` — the correct first frame for both single- and multi-video games.
 * A click-time clip seek (known before `/load`) is appended as a `#t=` fragment.
 * Resume position is NOT encoded here — it is only known from `/load` and is
 * applied later via a post-load seek (see computeResumePosition).
 *
 * @param {string} gameId
 * @param {number|null} pendingClipSeekTime — seconds, or null for first paint at t=0
 * @returns {string}
 */
export function buildEarlyGameVideoSrc(gameId, pendingClipSeekTime = null) {
  let src = `${API_BASE}/api/games/${gameId}/video`;
  if (pendingClipSeekTime != null) {
    src += `#t=${pendingClipSeekTime}`;
  }
  return src;
}

// In-flight dedup for beginGameVideoLoad — keyed by gameId. Mirrors gamesDataStore's
// loadGame/getGame `_getGameInflight` pattern. Without it, a double-invoke (React
// StrictMode's double effect, a rapid remount) runs the early src-set twice, firing a
// second /video 302 + second R2 range fetch (loadGame already dedups /load, which is
// why only the video doubled). The entry clears when /load settles, so a genuine
// later re-open still works.
const _beginLoadInflight = new Map();

/**
 * Begin loading a saved game's video.
 *
 * Sets the stable first-paint src synchronously (so the byte fetch starts now),
 * then kicks off `/load` and returns its in-flight promise. The synchronous
 * src-set BEFORE awaiting `loadGame` is the core T4000 optimization: the two
 * round-trips overlap instead of chaining. Deduped by gameId so a StrictMode /
 * remount double-invoke does not fire two /video fetches.
 *
 * @param {Object} params
 * @param {string|number} params.gameId
 * @param {number|null} [params.pendingClipSeekTime]
 * @param {(url: string) => void} params.setAnnotateVideoUrl
 * @param {(gameId: string|number) => Promise<any>} params.loadGame
 * @returns {Promise<any>} the in-flight loadGame promise
 */
export function beginGameVideoLoad({ gameId, pendingClipSeekTime = null, setAnnotateVideoUrl, loadGame }) {
  const existing = _beginLoadInflight.get(gameId);
  if (existing) return existing;

  setAnnotateVideoUrl(buildEarlyGameVideoSrc(gameId, pendingClipSeekTime));
  const promise = Promise.resolve(loadGame(gameId));
  _beginLoadInflight.set(gameId, promise);
  promise.finally(() => {
    if (_beginLoadInflight.get(gameId) === promise) {
      _beginLoadInflight.delete(gameId);
    }
  });
  return promise;
}

/** Test seam: clear the beginGameVideoLoad in-flight dedup between tests. */
export function __resetBeginLoadDedup() {
  _beginLoadInflight.clear();
}

/**
 * Compute the resume playhead position for a single-video game from `/load` data.
 *
 * Prefers the exact `last_playhead_position`; falls back to the legacy
 * `viewed_duration` high-water mark for games saved before that field existed.
 * Returns null when there is nothing to resume (no saved position, already at the
 * end, or within the last 5% — treated as finished). Mirrors the suffix logic the
 * loader previously baked into the playback URL.
 *
 * @param {Object|null} gameData
 * @returns {number|null} resume position in seconds, or null
 */
export function computeResumePosition(gameData) {
  if (!gameData || !(gameData.video_duration > 0)) return null;
  const duration = gameData.video_duration;

  const lastPlayhead = gameData.last_playhead_position;
  if (lastPlayhead != null && lastPlayhead < duration) {
    return lastPlayhead;
  }

  const viewed = gameData.viewed_duration;
  if (viewed > 0 && viewed / duration < 0.95) {
    return viewed;
  }

  return null;
}

/**
 * Seek a single-video `<video>` element to `pos` once it can accept a seek.
 *
 * If metadata is already loaded (`readyState >= HAVE_METADATA`) the seek applies
 * immediately; otherwise it is deferred to a one-shot `loadedmetadata` listener.
 * This is a read action (`currentTime = pos`), not persistence — it does not write
 * to any store or backend.
 *
 * @param {HTMLVideoElement|null} video
 * @param {number|null} pos — seconds
 */
export function seekVideoElementWhenReady(video, pos) {
  if (!video || pos == null) return;

  const apply = () => {
    try {
      video.currentTime = pos;
    } catch {
      // Element not seekable yet (e.g. detached mid-load) — drop the seek.
    }
  };

  // HTMLMediaElement.HAVE_METADATA === 1
  if (video.readyState >= 1) {
    apply();
    return;
  }

  const onMeta = () => {
    video.removeEventListener('loadedmetadata', onMeta);
    apply();
  };
  video.addEventListener('loadedmetadata', onMeta);
}
