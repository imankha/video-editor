import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsCoarsePointer } from './useIsMobile';

/**
 * useTilePreview (T6420) — the activation state machine behind the shared
 * TilePreviewVideo primitive: grace window, warm-early/reveal-late timing, the
 * single-active registry, teardown, and the capability/reduced-motion gate.
 *
 * "Warm early, reveal late" (EPIC design authority): the intent delay gates the
 * REVEAL, not the fetch. A straight-line grid crossing fires ZERO requests (grace
 * window); a dwell attaches the stream at ~WARM ms and buffers.
 *
 * REVEAL timing (2026-08-14 policy, all hover-preview tiers): artificial delay =
 * PREVIEW_REVEAL_DELAY_MS - real load latency, floored at 0 — i.e. REVEAL fires at
 * max(PREVIEW_REVEAL_DELAY_MS, load-ready time). A fast-loading tier (final/working
 * video) still waits the full ~450ms floor (flicker avoidance on a quick mouse
 * pass — content being ready sooner never reveals it sooner). A slow-loading tier
 * (T6820's source-clip window: moov + a mid-file byte range, real seek latency)
 * never pays an ADDITIONAL flat 450ms on top of its own real fetch time — it
 * reveals as soon as content is actually ready. Implemented by tracking two
 * independent conditions — the floor timer and a content-ready signal from
 * TilePreviewVideo's `onContentReady` — and transitioning to REVEAL only once
 * BOTH are true (whichever finishes second decides the moment). Previously this
 * was a blind fixed timer with no readiness signal, so a slow tier paid floor +
 * real-load-time back to back (user report: hover felt "very long").
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
export const PREVIEW_REVEAL_DELAY_MS = 450; // floor: REVEAL never fires before this many ms
// of hover dwell, but WILL fire later if real content-load latency exceeds it (see policy above).

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
 *   onPointerLeave: Function, stop: Function, onContentReady: Function }}
 *   onContentReady is wired to TilePreviewVideo's `onContentReady` prop — it
 *   reports the real content-load-ready signal this hook races against the floor.
 */
export function useTilePreview({ streamUrl } = {}) {
  const isCoarsePointer = useIsCoarsePointer();
  const prefersReducedMotion = usePrefersReducedMotion();
  const enabled = Boolean(streamUrl) && !isCoarsePointer && !prefersReducedMotion;

  const [phase, setPhase] = useState(PREVIEW_PHASE.IDLE);
  const warmTimerRef = useRef(null);
  const revealFloorTimerRef = useRef(null);
  // The two conditions REVEAL races: the floor timer (always PREVIEW_REVEAL_DELAY_MS
  // of hover dwell) and the real content-ready signal. REVEAL fires when both are
  // true, set by whichever finishes second — see the policy note above the exports.
  const floorReachedRef = useRef(false);
  const contentReadyRef = useRef(false);
  // stop() is captured by the module registry; a ref keeps the captured identity
  // stable across renders so releaseActivePreview's identity check is reliable.
  const stopRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (warmTimerRef.current) {
      clearTimeout(warmTimerRef.current);
      warmTimerRef.current = null;
    }
    if (revealFloorTimerRef.current) {
      clearTimeout(revealFloorTimerRef.current);
      revealFloorTimerRef.current = null;
    }
    floorReachedRef.current = false;
    contentReadyRef.current = false;
  }, []);

  // Teardown to idle. Idempotent — safe to call repeatedly (pointer leave, unmount,
  // registry force-stop, disable). Also the exact callback the registry invokes.
  const stop = useCallback(() => {
    clearTimers();
    releaseActivePreview(stopRef.current);
    setPhase(PREVIEW_PHASE.IDLE);
  }, [clearTimers]);
  stopRef.current = stop;

  const tryReveal = useCallback(() => {
    if (floorReachedRef.current && contentReadyRef.current) {
      setPhase(PREVIEW_PHASE.REVEAL);
    }
  }, []);

  const onPointerEnter = useCallback(() => {
    if (!enabled) return; // coarse pointer / reduced motion / no stream: inert
    clearTimers();
    warmTimerRef.current = setTimeout(() => {
      warmTimerRef.current = null;
      // Claim the single-active slot the instant we fire a request (warm), so at
      // most one tile ever buffers/plays; this force-stops whoever was active.
      claimActivePreview(stopRef.current);
      setPhase(PREVIEW_PHASE.WARM);
      revealFloorTimerRef.current = setTimeout(() => {
        revealFloorTimerRef.current = null;
        floorReachedRef.current = true;
        tryReveal();
      }, Math.max(0, PREVIEW_REVEAL_DELAY_MS - PREVIEW_WARM_DELAY_MS));
    }, PREVIEW_WARM_DELAY_MS);
  }, [enabled, clearTimers, tryReveal]);

  // TilePreviewVideo calls this once the real content is ready to play (its own
  // 'loadeddata'/'canplay' signal) — the OTHER half of the REVEAL race.
  const onContentReady = useCallback(() => {
    contentReadyRef.current = true;
    tryReveal();
  }, [tryReveal]);

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
    onContentReady,
    stop,
  };
}

export default useTilePreview;
