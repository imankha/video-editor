import React, { useRef, useEffect } from 'react';
import { API_BASE } from '../../config';

/**
 * ClipVideo - a full-bleed clip that NEVER shows black deadspace (T3630).
 *
 * Two stacked layers fill the parent (which must be `relative`):
 *  - blur layer: the same clip, `object-cover` + blurred + scaled, so it always
 *    fills the box edge-to-edge. Skipped when `blur` is false (e.g. tiny
 *    thumbnails) -- one fewer video decoder.
 *  - sharp layer: the clip on top (object-contain with blur, object-cover
 *    without). Where it's letterboxed, the blur shows through -- full-bleed,
 *    never black.
 *
 * Lifecycle matters: browsers cap concurrent video decoders, so we RELEASE both
 * <video> elements on unmount and reload on a clip change -- otherwise decoders
 * pile up across matchups and playback stalls. Callers should also AVOID a
 * remount key so swaps reuse the element instead of churning new ones.
 *
 * @param {string}   streamUrl - same-origin stream path
 * @param {boolean}  active    - autoplay the sharp layer (the visible clip)
 * @param {boolean}  muted     - mute the sharp layer (set via ref); falls back
 *                               to muted if the browser blocks sound autoplay
 * @param {boolean}  loop      - loop the sharp layer (false -> fires onEnded)
 * @param {Function} onEnded   - sharp layer reached the end (auto-swap)
 * @param {boolean}  blur      - render the blur fill layer (default true)
 */
export function ClipVideo({ streamUrl, active = true, muted = true, loop = true, onEnded, blur = true }) {
  const url = `${API_BASE}${streamUrl}`;
  const sharpRef = useRef(null);
  const blurRef = useRef(null);

  // Reload sources when the clip changes -> releases the old media (no decoder /
  // buffer pile-up) and starts the new one from the top. We also re-assert src
  // first: React won't re-apply the unchanged `src` prop after StrictMode's dev
  // mount->cleanup->remount runs the release cleanup below (removeAttribute
  // 'src'), which would otherwise leave the <video> source-less and blank.
  useEffect(() => {
    for (const v of [blurRef.current, sharpRef.current]) {
      if (!v) continue;
      if (v.getAttribute('src') !== url) v.setAttribute('src', url);
      v.load();
    }
  }, [url]);

  // Play + mute control. `muted` is set via the DOM property (React's attribute
  // is unreliable) with a fallback to muted if sound autoplay is blocked.
  //
  // A single one-shot play() is fragile: browsers cap concurrent decoders, and
  // the load() above (or a sibling card mounting at the same time) can abort an
  // in-flight play(), leaving the clip stuck paused while its twin plays fine
  // (it works alone in full-screen, where there's no contention). So we re-assert
  // play() on `canplay` (fires once the decoder/media is actually ready) and
  // recover if the clip is evicted/paused while it's still meant to be playing.
  useEffect(() => {
    const v = sharpRef.current;
    if (!v) return;
    v.muted = muted;
    if (!active) return;

    const tryPlay = () => {
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => { v.muted = true; v.play().catch(() => {}); });
      }
    };
    // `ended` (natural finish) sets paused without a play intent -- don't fight
    // it (hero auto-advance relies on onEnded); only recover unexpected pauses.
    const onPause = () => { if (!v.ended) tryPlay(); };

    tryPlay();
    v.addEventListener('canplay', tryPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('canplay', tryPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [active, muted, url]);

  // Free both <video> resources on unmount so decoders/buffers don't accumulate.
  useEffect(() => () => {
    for (const v of [sharpRef.current, blurRef.current]) {
      if (!v) continue;
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
    }
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900">
      {blur && (
        <video
          ref={blurRef}
          src={url}
          muted playsInline preload="metadata" aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70 pointer-events-none"
        />
      )}
      <video
        ref={sharpRef}
        src={url}
        muted={muted} loop={loop} playsInline preload="metadata"
        autoPlay={active} onEnded={onEnded}
        className={`absolute inset-0 z-[1] w-full h-full ${blur ? 'object-contain' : 'object-cover'}`}
      />
    </div>
  );
}

export default ClipVideo;
