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
  const url = `${API_BASE}${streamUrl}`;
  return (
    <div className="absolute inset-0 overflow-hidden">
      <video
        src={`${url}#t=0.1`}
        muted playsInline preload="metadata" aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70 pointer-events-none"
      />
      <video
        src={active ? url : `${url}#t=0.1`}
        muted loop playsInline preload="metadata" autoPlay={active}
        className="absolute inset-0 z-[1] w-full h-full object-contain"
      />
    </div>
  );
}

export default ClipVideo;
