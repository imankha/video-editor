import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsCoarsePointer } from './useIsMobile';

/**
 * useTilePreview (T6420) — the activation state machine behind the shared
 * TilePreviewVideo primitive: grace window, warm-early/reveal-late timing, the
 * single-active registry, teardown, and the capability/reduced-motion gate.
 *
 * "Warm early, reveal late" (EPIC design authority): the intent delay gates the
 * REVEAL, not the fetch. A straight-line grid crossing fires ZERO requests (grace
 * window); a dwell attaches the stream at ~WARM ms and buffers, then plays and
 * crossfades at ~REVEAL ms so the first frame is typically ready by reveal time.
 *
 * Gate: FINE pointer only (this child, T6420) via useIsCoarsePointer() — never
 * width, never UA. Coarse-pointer activation is T6430 and rides the same registry.
 * prefers-reduced-motion: reduce disables the preview entirely (EPIC invariant).
 *
 * No writes, no persistence, no store: warm/reveal/teardown are pointer-driven,
 * not useEffect-watches-state side effects. Idempotent under StrictMode double
 * invoke and repeated registry force-stops.
 */

// The two timing constants — tuned HERE, the single source both tiles share.
export const PREVIEW_WARM_DELAY_MS = 100; // hover dwell before attaching src + buffering
export const PREVIEW_REVEAL_DELAY_MS = 450; // hover dwell before .play() + crossfade

export const PREVIEW_PHASE = {
  IDLE: 'idle', // no src, nothing buffering (grid at rest)
  WARM: 'warm', // src attached, muted + paused, buffering (poster still showing)
  REVEAL: 'reveal', // playing; crossfade video over poster on first rendered frame
};

// Single active preview app-wide (EPIC invariant): activating tile B force-stops
// tile A. Holds the currently-active tile's stop() callback. Module-level and
// deliberately general so T6430 (touch in-viewport autoplay) reuses it as-is.
let activePreviewStop = null;

function claimActivePreview(stop) {
  const previous = activePreviewStop;
  activePreviewStop = stop;
  // Force-stop the prior tile AFTER swapping the slot, so its own
  // releaseActivePreview() (which checks identity) is a no-op and can't recurse.
  if (previous && previous !== stop) previous();
}

function releaseActivePreview(stop) {
  if (activePreviewStop === stop) activePreviewStop = null;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Local to this hook (abstract-on-3rd-dup rule: no shared hook yet). Live
// matchMedia so toggling the OS setting takes effect without a reload.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const handler = (e) => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return reduced;
}

/**
 * @param {object}  opts
 * @param {?string} opts.streamUrl  the reel's /stream URL; null disables the preview
 *   (e.g. a draft with no rendered final video). Passing null is also the teardown
 *   trigger for "full player opening" on the host that clears it.
 * @returns {{ phase: string, active: boolean, onPointerEnter: Function,
 *   onPointerLeave: Function, stop: Function }}
 */
export function useTilePreview({ streamUrl } = {}) {
  const isCoarsePointer = useIsCoarsePointer();
  const prefersReducedMotion = usePrefersReducedMotion();
  const enabled = Boolean(streamUrl) && !isCoarsePointer && !prefersReducedMotion;

  const [phase, setPhase] = useState(PREVIEW_PHASE.IDLE);
  const warmTimerRef = useRef(null);
  const revealTimerRef = useRef(null);
  // stop() is captured by the module registry; a ref keeps the captured identity
  // stable across renders so releaseActivePreview's identity check is reliable.
  const stopRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (warmTimerRef.current) {
      clearTimeout(warmTimerRef.current);
      warmTimerRef.current = null;
    }
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);

  // Teardown to idle. Idempotent — safe to call repeatedly (pointer leave, unmount,
  // registry force-stop, disable). Also the exact callback the registry invokes.
  const stop = useCallback(() => {
    clearTimers();
    releaseActivePreview(stopRef.current);
    setPhase(PREVIEW_PHASE.IDLE);
  }, [clearTimers]);
  stopRef.current = stop;

  const onPointerEnter = useCallback(() => {
    if (!enabled) return; // coarse pointer / reduced motion / no stream: inert
    clearTimers();
    warmTimerRef.current = setTimeout(() => {
      warmTimerRef.current = null;
      // Claim the single-active slot the instant we fire a request (warm), so at
      // most one tile ever buffers/plays; this force-stops whoever was active.
      claimActivePreview(stopRef.current);
      setPhase(PREVIEW_PHASE.WARM);
      revealTimerRef.current = setTimeout(() => {
        revealTimerRef.current = null;
        setPhase(PREVIEW_PHASE.REVEAL);
      }, PREVIEW_REVEAL_DELAY_MS - PREVIEW_WARM_DELAY_MS);
    }, PREVIEW_WARM_DELAY_MS);
  }, [enabled, clearTimers]);

  const onPointerLeave = useCallback(() => {
    stop();
  }, [stop]);

  // Teardown on unmount (leave, scroll-out via re-render, navigation) — releases
  // the stream and the registry slot. stop() is stable, so this binds once.
  useEffect(() => () => stop(), [stop]);

  // If the preview becomes disabled while active (pointer flips to coarse, OS
  // reduced-motion toggles on, or streamUrl clears because the full player opened),
  // tear down. This is reacting to a capability/prop change, not persisting state.
  useEffect(() => {
    if (!enabled && phase !== PREVIEW_PHASE.IDLE) stop();
  }, [enabled, phase, stop]);

  return {
    phase,
    active: phase !== PREVIEW_PHASE.IDLE,
    onPointerEnter,
    onPointerLeave,
    stop,
  };
}

export default useTilePreview;
