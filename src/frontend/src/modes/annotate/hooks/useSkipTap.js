import { useState, useRef, useCallback, useEffect } from 'react';

// T14350: YouTube's double-tap skip. Same 5 s as the transport buttons.
export const SKIP_TAP_SECONDS = 5;
// Two taps on one half within this window are a double tap.
export const DOUBLE_TAP_MS = 300;
// After a skip, further taps on the same half within this window add 5 s each.
export const BURST_MS = 700;

// Taps on a control inside the video surface (Retry, notes links) are not skips.
const INTERACTIVE = 'button, a, input, select, textarea';

/**
 * useSkipTap - YouTube-style double-tap / double-click skip on the video.
 *
 * Attach `onClickCapture` to the video stage. Left half = back, right half =
 * forward. Clicks fire for taps too, so one handler covers desktop and touch.
 *
 * The single tap keeps its existing meaning (play/pause) and is never delayed:
 * tap 1 toggles as before, tap 2 skips AND propagates so its toggle undoes tap
 * 1's (playing state unchanged, as on YouTube), taps 3+ in the burst skip and
 * are swallowed so they don't toggle again.
 *
 * `feedback` ({ side, seconds, id } | null) drives the ripple; `seconds` is the
 * burst's running total. View state only, never persisted.
 */
export function useSkipTap({ enabled, onSeekForward, onSeekBackward }) {
  const [feedback, setFeedback] = useState(null);
  const lastTapRef = useRef(null); // { time, side } of an unpaired tap
  const burstRef = useRef(null); // { side, total, time } of the active burst
  const clearTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(clearTimerRef.current), []);

  const skip = useCallback((side, total) => {
    if (side === 'left') onSeekBackward(SKIP_TAP_SECONDS);
    else onSeekForward(SKIP_TAP_SECONDS);
    setFeedback({ side, seconds: total, id: Date.now() });
    clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      setFeedback(null);
      burstRef.current = null;
    }, BURST_MS);
  }, [onSeekForward, onSeekBackward]);

  const onClickCapture = useCallback((e) => {
    if (!enabled) return;
    if (e.target?.closest?.(INTERACTIVE)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();

    const burst = burstRef.current;
    if (burst && burst.side === side && now - burst.time < BURST_MS) {
      burst.total += SKIP_TAP_SECONDS;
      burst.time = now;
      e.stopPropagation();
      skip(side, burst.total);
      return;
    }

    const last = lastTapRef.current;
    if (last && last.side === side && now - last.time < DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      burstRef.current = { side, total: SKIP_TAP_SECONDS, time: now };
      skip(side, SKIP_TAP_SECONDS);
      return;
    }

    burstRef.current = null;
    lastTapRef.current = { time: now, side };
  }, [enabled, skip]);

  return { onClickCapture, feedback };
}
