import { useLayoutEffect, useState } from 'react';
import { transientSlot } from './placement';
import { GUIDE_PULSE_CLASS } from './guideTargets';

const COACH_HOST = '[data-testid="floating-coach-host"]';
/** The bottom-right export progress card: the transient card's CSS home sits above it, and a move must not land on it. */
const EXPORT_INDICATOR = '[data-testid="global-export-indicator"]';
const rectsOf = selector => [...document.querySelectorAll(selector)].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);

/**
 * T13570: a short-lived corner card (`data-guide-transient`) never covers the coach card, a pulsing control or
 * the rule's keepClear rects (FloatingCoach puts its keepClear selectors on the host as `data-keep-clear`), nor the export indicator.
 * `home` is the card's own CSS spot as { right, bottom } px. Returns null while that spot is clear, else a
 * { left, top } to pin it to. Re-reads every frame while `active` (the card lives about 8s). View state only.
 */
export function useClearOfGuide(ref, active, home) {
  const [spot, setSpot] = useState(null);
  useLayoutEffect(() => {
    if (!active) { setSpot(null); return undefined; }
    let raf;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const hosts = [...document.querySelectorAll(COACH_HOST)].filter(h => h.style.visibility !== 'hidden');
        const keepOut = [
          ...hosts.map(h => h.getBoundingClientRect()),
          ...rectsOf(`.${GUIDE_PULSE_CLASS}`),
          ...rectsOf(EXPORT_INDICATOR),
          ...hosts.flatMap(h => (h.dataset.keepClear ? h.dataset.keepClear.split(',') : []).flatMap(rectsOf)),
        ].filter(r => r.width && r.height);
        const { width, height } = el.getBoundingClientRect();
        // clientWidth/Height: the box `fixed right-4 bottom-24` is measured from (innerWidth includes a classic scrollbar).
        const { clientWidth: vw, clientHeight: vh } = document.documentElement;
        const preferred = { left: vw - home.right - width, top: vh - home.bottom - height };
        const next = transientSlot({ width, height }, { width: vw, height: vh }, keepOut, preferred);
        setSpot(old => (old === next || (old && next && old.left === next.left && old.top === next.top) ? old : next));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ref, active, home.right, home.bottom]);
  return spot;
}
