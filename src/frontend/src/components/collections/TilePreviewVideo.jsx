import { useEffect, useRef, useState } from 'react';
import { PREVIEW_PHASE } from '../../hooks/useTilePreview';

/**
 * TilePreviewVideo (T6420) — the shared, store-free inline hover-preview video for
 * DraftTile + ReelTile. Two consumers is below the abstract-on-3rd-dup bar, but the
 * sibling tiles MUST NOT diverge (T6300's history); this is the same justification
 * as T6320's shared progress-track primitive. Keep it props-driven and store-free
 * (T6320 rule: a store import here would break the landing build via the @editor
 * alias) so both tiles stay byte-identical.
 *
 * Poster-first, always: renders a muted / looping / pointer-events-none <video>
 * absolute over the tile poster and crossfades it in ONLY once a real frame has
 * rendered (requestVideoFrameCallback, with the `playing` event as fallback) — never
 * a black flash, never a spinner. The poster (owned by the host tile, layered below)
 * IS the loading state. `pointer-events-none` keeps the tile's hover action reveal
 * (T5910/T6300) working over the playing video.
 *
 * Activation timing + the single-active registry live in useTilePreview; this
 * component is pure imperative playback control driven by the `phase` prop:
 *   IDLE   -> no src, paused, faded out (grid at rest: preload="none" => 0 requests)
 *   WARM   -> src attached, buffering, still paused (poster showing)
 *   REVEAL -> play(); crossfade in on the first rendered frame
 *
 * Mounted INSIDE the tile, never portaled (T5900): the tile's hover-scale transform
 * makes it the containing block, so a `fixed` child would detach — `absolute inset-0`
 * rides the transform correctly.
 */
export function TilePreviewVideo({ streamUrl, phase, onFirstFrame, startTime, endTime, className = '' }) {
  const videoRef = useRef(null);
  const rvfcRef = useRef(null);
  const [shown, setShown] = useState(false);
  // Keep the latest onFirstFrame without re-running the playback effect when a host
  // passes an inline callback.
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;

    const cancelFrameCb = () => {
      if (rvfcRef.current != null && typeof v.cancelVideoFrameCallback === 'function') {
        v.cancelVideoFrameCallback(rvfcRef.current);
      }
      rvfcRef.current = null;
    };

    if (phase === PREVIEW_PHASE.IDLE || !streamUrl) {
      // Teardown: pause and RELEASE the stream (clear src + load), reset crossfade.
      // Idempotent — safe under StrictMode double-invoke and registry force-stops.
      cancelFrameCb();
      v.pause();
      if (v.getAttribute('src')) {
        v.removeAttribute('src');
        v.load(); // drops the buffered data + the connection
      }
      setShown(false);
      return cancelFrameCb;
    }

    // React's `muted` JSX attribute is not reliably reflected to the DOM property,
    // and muted-autoplay depends on the PROPERTY — set it imperatively so play()
    // isn't rejected by the autoplay policy (audio never, EPIC invariant).
    v.muted = true;

    // WARM or REVEAL: attach the stream (idempotent via getAttribute compare — note
    // getAttribute returns the raw relative URL, unlike v.src which resolves it) and
    // begin buffering. preload="none" at rest means nothing loads until this runs.
    if (v.getAttribute('src') !== streamUrl) {
      v.setAttribute('src', streamUrl);
      v.load();
    }
    if (phase === PREVIEW_PHASE.REVEAL) {
      if (typeof v.requestVideoFrameCallback === 'function' && rvfcRef.current == null) {
        rvfcRef.current = v.requestVideoFrameCallback(() => {
          rvfcRef.current = null;
          setShown(true);
          onFirstFrameRef.current?.();
        });
      }
      const p = v.play();
      // Autoplay may reject (e.g. not enough buffered yet) — keep the poster, the
      // crossfade fires whenever the first frame actually lands. Never a black box.
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    return cancelFrameCb;
  }, [phase, streamUrl]);

  // T6820 — bounded source-clip window. The clip-stream proxy serves the WHOLE
  // source game video's byte layout, so a naive play would start at t=0 (game
  // start, outside the clip) and native-loop the entire file. When startTime is
  // provided (Not-Started draft previews), seek into the window on metadata load
  // and loop back to startTime once playback passes endTime. Absent props
  // (final/working-video previews) leave the code path — and native loop — exactly
  // as before, so the two existing consumers stay byte-identical.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || startTime == null) return undefined;
    const seekToStart = () => { v.currentTime = startTime; };
    const loopWindow = () => {
      if (endTime != null && v.currentTime >= endTime) v.currentTime = startTime;
    };
    v.addEventListener('loadedmetadata', seekToStart);
    v.addEventListener('timeupdate', loopWindow);
    return () => {
      v.removeEventListener('loadedmetadata', seekToStart);
      v.removeEventListener('timeupdate', loopWindow);
    };
  }, [startTime, endTime]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      // Native loop restarts at t=0 — correct for final/working previews (the file
      // IS the clip), wrong for the windowed source proxy (would jump to game
      // start). With a window, looping is handled manually above; disable native.
      loop={startTime == null}
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
      // Fallback for browsers without requestVideoFrameCallback: `playing` fires when
      // playback actually starts (a frame is presented), so the crossfade is still
      // frame-accurate enough to avoid a black flash.
      onPlaying={() => setShown(true)}
      className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300 ${
        shown ? 'opacity-100' : 'opacity-0'
      } ${className}`}
    />
  );
}

export default TilePreviewVideo;
