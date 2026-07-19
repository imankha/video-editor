import { useEffect } from 'react';

/**
 * useSpotlightLoop - Enforce the spotlight loop during Overlay-mode playback.
 *
 * When the user presses the primary "Play spotlight" button, playback runs in
 * `'loop'` mode over the span `[span.start, span.end]` (the span of ALL highlight
 * regions, computed by OverlayContainer). This hook watches `currentTime` and,
 * once the playhead reaches the span end, seeks back to the span start so the
 * spotlight plays continuously.
 *
 * IMPORTANT — this is NOT a persistence-rule violation (T350 class). The banned
 * pattern is a reactive `useEffect` that writes editing state to the store/backend.
 * `seek()` is ephemeral *playback* control (it moves the `<video>` playhead), not a
 * DB/store *write*. Watching `currentTime` to wrap playback touches no persistent
 * data.
 *
 * No-op (returns without seeking) in every case except an active loop:
 *   - `playMode !== 'loop'` (e.g. "Play full" mode)
 *   - `span` is null (zero highlight regions — nothing to loop)
 *   - not playing (paused)
 *   - seeking (avoid fighting an in-flight seek; `useVideo` also skips RAF
 *     time-updates while `isSeeking`, so the wrap seek stays clean)
 *
 * @param {Object}   params
 * @param {'loop'|'full'} params.playMode - Current ephemeral play-mode
 * @param {{start:number,end:number}|null} params.span - Spotlight span (all regions)
 * @param {number}   params.currentTime - Current playhead time (seconds)
 * @param {boolean}  params.isPlaying - Whether the video is playing
 * @param {boolean}  params.isSeeking - Whether the video is mid-seek
 * @param {Function} params.seek - Ephemeral playback seek (moves the playhead)
 */
const LOOP_EPS = 0.03; // ~1 frame at 30fps; wrap just before the exact end

export function useSpotlightLoop({ playMode, span, currentTime, isPlaying, isSeeking, seek }) {
  useEffect(() => {
    if (playMode !== 'loop' || !span || !isPlaying || isSeeking) return;
    if (currentTime >= span.end - LOOP_EPS) {
      seek(span.start); // wrap to the spotlight start
    }
  }, [playMode, span, currentTime, isPlaying, isSeeking, seek]);
}

export default useSpotlightLoop;
