import React from 'react';
import { API_BASE } from '../../config';

/**
 * ClipVideo - a full-bleed clip that NEVER shows black deadspace (T3630).
 *
 * Two stacked layers fill the parent (which must be `relative`):
 *  - blur layer: the same clip, `object-cover` + blurred + scaled, so it always
 *    fills the box edge-to-edge.
 *  - sharp layer: `object-contain` at the clip's true aspect on top. Wherever the
 *    sharp clip is letterboxed, the gap is transparent and the blur shows through
 *    -- so a portrait clip in a wide slot (or vice-versa) reads full-bleed, never
 *    black. One mechanism handles every layout/orientation.
 *
 * `active` autoplays the sharp layer (muted+looped); inactive shows the poster
 * frame only (used for the swap thumbnail), keeping idle clips cheap.
 *
 * @param {string}  streamUrl - same-origin stream path (e.g. /api/downloads/ID/stream)
 * @param {boolean} active    - autoplay + loop the sharp layer (the visible clip)
 */
export function ClipVideo({ streamUrl, active = true }) {
  // Same URL for both layers so the browser cache serves the second from the
  // first (no duplicate full-file fetch). A dark gradient backs the box so it's
  // never pure black while the first frame loads.
  const url = `${API_BASE}${streamUrl}`;
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900">
      <video
        src={url}
        muted playsInline preload="metadata" aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70 pointer-events-none"
      />
      <video
        src={url}
        muted loop playsInline preload="metadata" autoPlay={active}
        className="absolute inset-0 z-[1] w-full h-full object-contain"
      />
    </div>
  );
}

export default ClipVideo;
