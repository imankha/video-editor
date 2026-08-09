// T6710 — the intro's own clock (design §4(ii) / §3). A real rAF-driven clock
// for a real non-media WAAPI animation set (MotionPreview) — deliberately NOT
// a fake `{currentTime, duration, play}` object handed to `useStoryPlayback`
// (that shape is a faked media element, banned by the coding standards; see
// design §3's rejection of approach (b1)).
//
// `introTimeMs` is the single source of truth for the intro's position while
// it is active; the composite (`IntroStoryPlayer`) derives global position
// from it, never mirrors it into a second piece of state.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @param {number} introDurationSec
 * @param {Object=} opts
 * @param {Function=} opts.onIntroEnded - fired exactly once when the clock
 *   reaches durationMs (via rAF advance OR a direct seekIntro to the end).
 */
export function useIntroPlayback(introDurationSec, { onIntroEnded } = {}) {
  const durationMs = (introDurationSec || 0) * 1000;

  const [introTimeMs, setIntroTimeMs] = useState(0);
  const [playing, setPlaying] = useState(true);

  const rafRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  // Mirrors `playing` for the tick closure to read synchronously: a scheduled
  // rAF callback can still fire once after `playing` flips to false (real
  // browsers included — cancelAnimationFrame is not guaranteed synchronous
  // against an in-flight callback), so the loop must self-guard rather than
  // rely solely on the cleanup's cancelAnimationFrame call.
  const playingRef = useRef(true);
  // Guards onIntroEnded firing more than once for the same "reached the end"
  // event, whether that end was reached via rAF advance or a direct seek.
  const endedFiredRef = useRef(false);
  const onIntroEndedRef = useRef(onIntroEnded);
  onIntroEndedRef.current = onIntroEnded;

  const fireEndedOnce = useCallback(() => {
    if (endedFiredRef.current) return;
    endedFiredRef.current = true;
    onIntroEndedRef.current?.();
  }, []);

  const seekIntro = useCallback((ms) => {
    const clamped = Math.max(0, Math.min(ms, durationMs));
    setIntroTimeMs(clamped);
    if (clamped >= durationMs) fireEndedOnce();
    else endedFiredRef.current = false; // seeking back before the end re-arms the guard
  }, [durationMs, fireEndedOnce]);

  // rAF forward-advance loop — active only while playing. Frozen (no
  // scheduling) whenever `playing` is false, which is also how the composite
  // freezes this clock when region !== 'intro' (it simply doesn't drive
  // `playing` while inactive / stops mounting this hook's consumer).
  useEffect(() => {
    playingRef.current = playing;
    if (!playing) {
      lastFrameTimeRef.current = null;
      return undefined;
    }

    lastFrameTimeRef.current = performance.now();

    const tick = (now) => {
      if (!playingRef.current) return; // stale frame from before a pause — no-op
      const dt = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      setIntroTimeMs((prev) => {
        const next = Math.min(prev + dt, durationMs);
        if (next >= durationMs) fireEndedOnce();
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameTimeRef.current = null;
    };
  }, [playing, durationMs, fireEndedOnce]);

  return { introTimeMs, playing, setPlaying, seekIntro, onIntroEnded: fireEndedOnce };
}

export default useIntroPlayback;
