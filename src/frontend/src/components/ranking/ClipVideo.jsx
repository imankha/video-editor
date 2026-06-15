import React, { useRef, useEffect } from 'react';
import { API_BASE } from '../../config';

/**
 * ClipVideo - a full-bleed clip that NEVER shows black deadspace (T3630).
 *
 * Two stacked layers fill the parent (which must be `relative`):
 *  - blur layer: the same clip, `object-cover` + blurred + scaled, so it always
 *    fills the box edge-to-edge.
 *  - sharp layer: `object-contain` at the clip's true aspect on top. Wherever the
 *    sharp clip is letterboxed, the gap is transparent and the blur shows
 *    through -- so a portrait clip in a wide slot (or vice-versa) reads
 *    full-bleed, never black.
 *
 * Both layers share one URL so the browser cache serves the second from the
 * first (no duplicate fetch). The box has a dark gradient backing so it is never
 * pure black while the first frame loads.
 *
 * @param {string}   streamUrl - same-origin stream path (e.g. /api/downloads/ID/stream)
 * @param {boolean}  active    - autoplay the sharp layer (the visible clip)
 * @param {boolean}  muted     - mute the sharp layer (set via ref -- the React
 *                               `muted` attribute is unreliable). Blur is always
 *                               muted. Falls back to muted if the browser blocks
 *                               autoplay-with-sound.
 * @param {boolean}  loop      - loop the sharp layer (false -> fires onEnded once)
 * @param {Function} onEnded   - sharp layer reached the end (used for auto-swap)
 */
export function ClipVideo({ streamUrl, active = true, muted = true, loop = true, onEnded }) {
  const url = `${API_BASE}${streamUrl}`;
  const ref = useRef(null);

  // Enforce muted via the DOM property (React's `muted` attr doesn't reflect),
  // and start playback -- falling back to muted if sound autoplay is blocked.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    if (!active) return;
    const p = v.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { v.muted = true; v.play().catch(() => {}); });
    }
  }, [active, muted, url]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900">
      <video
        src={url}
        muted playsInline preload="metadata" aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70 pointer-events-none"
      />
      <video
        ref={ref}
        src={url}
        muted={muted} loop={loop} playsInline preload="metadata"
        autoPlay={active} onEnded={onEnded}
        className="absolute inset-0 z-[1] w-full h-full object-contain"
      />
    </div>
  );
}

export default ClipVideo;
