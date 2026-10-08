import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useGuidanceSettings } from '../../stores/settingsStore';

import { placeCoach } from './placement';
/** Shared floating host. Observers exist only while guidance is enabled. */
function ActiveCoach({ children, target, fallbackTarget, side = 'top', phase }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const [scrollDirection, setScrollDirection] = useState(null);
  useLayoutEffect(() => {
    let raf;
    const measure = () => {
      const card = ref.current;
      let anchor = document.querySelector(target);
      let rect = anchor?.getBoundingClientRect();
      const targetOffscreen = rect && (rect.bottom < 56 || rect.top > innerHeight - 60);
      if (targetOffscreen) setScrollDirection(rect.top > innerHeight - 60 ? 'down' : 'up');
      else setScrollDirection(null);
      if ((!rect || targetOffscreen) && fallbackTarget) {
        anchor = document.querySelector(fallbackTarget); rect = anchor?.getBoundingClientRect();
      }
      if (!card || !rect || !rect.width || !rect.height) { setPosition(null); return; }
      const next = placeCoach(rect, card.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, side);
      setPosition(old => old?.left === next?.left && old?.top === next?.top ? old : next);
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
  return createPortal(<>
    <div ref={ref} data-testid="floating-coach-host"
    className="fixed z-[110] w-[min(calc(100vw-24px),26rem)] pointer-events-none [&_button]:pointer-events-auto"
    style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>{children}</div>
    {scrollDirection && <div data-testid="guidance-scroll-hint" className={`fixed left-1/2 z-[109] -translate-x-1/2 rounded-full border border-amber-300/70 bg-gray-950/95 px-3 py-2 text-amber-200 shadow-xl ${scrollDirection === 'down' ? 'bottom-4' : 'top-4'}`}>
      {scrollDirection === 'down' ? <ChevronDown size={20} aria-label="Scroll down to find the guided action" /> : <ChevronUp size={20} aria-label="Scroll up to find the guided action" />}
    </div>}
  </>, document.body);
}
export default function FloatingCoach(props) {
  const { coachEnabled = true } = useGuidanceSettings();
  return coachEnabled ? <ActiveCoach {...props} /> : null;
}
