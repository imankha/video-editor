import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGuidanceSettings } from '../../stores/settingsStore';

import { placeCoach } from './placement';
/** Shared floating host. Observers exist only while guidance is enabled. */
function ActiveCoach({ children, target, fallbackTarget, side = 'top', phase }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    let raf;
    const measure = () => {
      const card = ref.current;
      let anchor = document.querySelector(target);
      let rect = anchor?.getBoundingClientRect();
      if ((!rect || rect.bottom < 56 || rect.top > innerHeight - 60) && fallbackTarget) {
        anchor = document.querySelector(fallbackTarget); rect = anchor?.getBoundingClientRect();
      }
      if (!card || !rect || !rect.width || !rect.height) { setPosition(null); return; }
      const next = placeCoach(rect, card.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, side);
      setPosition(old => old?.left === next.left && old?.top === next.top ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? { observe() {}, disconnect() {} } : new ResizeObserver(schedule);
    if (ref.current) observer.observe(ref.current);
    for (const selector of [target, fallbackTarget].filter(Boolean)) {
      const anchor = document.querySelector(selector); if (anchor) observer.observe(anchor);
    }
    measure(); schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [target, fallbackTarget, side, phase]);
  return createPortal(<div ref={ref} data-testid="floating-coach-host"
    className="fixed z-[110] w-[min(calc(100vw-24px),26rem)] pointer-events-none [&_button]:pointer-events-auto"
    style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>{children}</div>, document.body);
}
export default function FloatingCoach(props) {
  const { coachEnabled = true } = useGuidanceSettings();
  return coachEnabled ? <ActiveCoach {...props} /> : null;
}
