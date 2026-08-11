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

// T6730 audit: consecutive rAF callbacks are normally ~16ms apart. A gap far
// above that means the browser stopped scheduling frames for this tab
// (backgrounded, main-thread stall) — crediting the whole gap to playback
// would let the intro silently skip itself the instant the user looks away
// and back. See the tick guard below.
const FRAME_GAP_BUDGET_MS = 250;

// T6740 decision B (option 1): any manual seek into the intro (e.g. the
// user clicking the Intro segment on the composite scrubber) holds the
// seeked-to pose on screen for at least this long before auto-continue is
// allowed to end the intro again. Without this, a seek landing near
// durationMs (T6730's audit finding B, the "dead band") let auto-continue
// fire again within a couple of frames — the click read as a no-op because
// there was nothing left to see. The floor is unconditional (not scaled to
// how close the seek landed to the end): "seeking into the intro always
// buys you at least a second to actually see it," not just clicks that
// happen to land in the last ~1% of the segment.
const MIN_DWELL_AFTER_SEEK_MS = 1000;

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
  // Mirrors introTimeMs synchronously for the rAF tick to read/compute
  // against — see the BUG FIX note in `tick` below for why the tick cannot
  // rely on setIntroTimeMs's functional-updater callback running
  // synchronously at the call site.
  const introTimeMsRef = useRef(0);

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
  // T6740 decision B: wall-clock deadline (performance.now()-based, NOT
  // introTimeMs) until which the tick below holds the clock frozen at its
  // just-seeked pose instead of advancing — set on every manual seek into
  // the intro, cleared once the dwell has elapsed. null = no seek is
  // currently being held (natural playback from mount is never held).
  const dwellUntilRef = useRef(null);

  const fireEndedOnce = useCallback(() => {
    if (endedFiredRef.current) return;
    endedFiredRef.current = true;
    onIntroEndedRef.current?.();
  }, []);

  const seekIntro = useCallback((ms) => {
    const clamped = Math.max(0, Math.min(ms, durationMs));
    introTimeMsRef.current = clamped;
    setIntroTimeMs(clamped);
    if (clamped >= durationMs) fireEndedOnce();
    else {
      endedFiredRef.current = false; // seeking back before the end re-arms the guard
      dwellUntilRef.current = performance.now() + MIN_DWELL_AFTER_SEEK_MS;
    }
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

      if (dwellUntilRef.current != null) {
        if (now < dwellUntilRef.current) {
          // T6740 decision B: holding the seeked-to pose visible until the
          // minimum dwell elapses — reschedule without advancing
          // introTimeMs at all, so the pose the user seeked to stays on
          // screen instead of racing straight through to durationMs.
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        dwellUntilRef.current = null;
      }

      if (dt > FRAME_GAP_BUDGET_MS) {
        // Assumption: consecutive rAF callbacks stay near a normal frame
        // interval. A gap this large means frames were dropped (tab hidden,
        // thread stalled) — skip this tick's advance entirely rather than
        // fast-forwarding the clock (and potentially firing onIntroEnded) by
        // however long the gap was.
        console.warn(
          `[useIntroPlayback] frame gap ${Math.round(dt)}ms exceeds the ${FRAME_GAP_BUDGET_MS}ms budget — treating as a resume, not advancing the clock (introTimeMs=${Math.round(introTimeMsRef.current)}/${Math.round(durationMs)})`,
        );
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // BUG FIX (QA live-drive, 3rd real defect this task): compute `next`
      // from introTimeMsRef (a synchronous mirror), NOT from inside
      // setIntroTimeMs's functional-updater callback, and call
      // fireEndedOnce() as a plain statement in this normal callback body.
      // The previous version called fireEndedOnce() (which cascades into
      // IntroStoryPlayer's own setRegion('reels'), a SIBLING component's
      // state) from inside the updater passed to setIntroTimeMs. Two
      // problems with that: (1) the updater's own execution is not
      // guaranteed synchronous at the call site (confirmed via
      // useIntroPlayback.test.js — reading a variable closed over by the
      // updater immediately after calling setIntroTimeMs saw a stale value),
      // and (2) even when it does run, a setState call for a DIFFERENT
      // fiber issued while React is mid-render for THIS hook's update is
      // eagerly computed (the updater runs) but never committed — the
      // real-browser symptom was the forward auto-continue silently never
      // firing (the intro froze at 100% forever). jsdom's renderHook harness
      // in useIntroPlayback.test.js drives a bare `vi.fn()` onIntroEnded (no
      // sibling component, no second setState), so neither failure mode was
      // visible there — only the real browser (this QA pass) caught it.
      // introTimeMsRef is kept in sync by every write path (seekIntro above,
      // this tick below) so `next` is always computed from a value that is
      // synchronously current, independent of when React actually commits
      // the corresponding setIntroTimeMs state update.
      const next = Math.min(introTimeMsRef.current + dt, durationMs);
      introTimeMsRef.current = next;
      setIntroTimeMs(next);
      if (next >= durationMs) fireEndedOnce();

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameTimeRef.current = null;
    };
  }, [playing, durationMs, fireEndedOnce]);

  return { introTimeMs, playing, setPlaying, seekIntro };
}

export default useIntroPlayback;
