import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * usePulseHighlight — shared "pulse one element" highlight (T8900 Fix-timing's
 * lane-change confirmation; T8910 reuses it for its footage-landing pulse, so it
 * lives here rather than inline in either feature — do not duplicate the animation).
 *
 * Tracks the single key currently pulsing and auto-clears it after the CSS
 * animation finishes. The consumer applies `PULSE_CLASS` to whichever element's
 * key matches the returned `pulseKey`. `nonce` changes on every `pulse()` call so
 * the same key pulsing twice in a row re-triggers the animation (React re-mounts
 * the class via the changed key attribute at the call site if it uses the nonce).
 */

// Must match the `.angle-pulse` rule in index.css.
export const PULSE_CLASS = 'angle-pulse';

// 0.6s per ring * 2 iterations, plus slack so the class outlives the animation.
const PULSE_MS = 1300;

export function usePulseHighlight() {
  const [pulseKey, setPulseKey] = useState(null);
  const [nonce, setNonce] = useState(0);
  const timerRef = useRef(null);

  const pulse = useCallback((key) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPulseKey(key);
    setNonce((n) => n + 1);
    timerRef.current = setTimeout(() => setPulseKey(null), PULSE_MS);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { pulseKey, pulseNonce: nonce, pulse };
}
