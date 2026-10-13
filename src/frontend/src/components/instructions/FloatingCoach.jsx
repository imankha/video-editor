import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useGuidanceSettings } from '../../stores/settingsStore';

import { Z } from '../../constants/zLayers';
import { placeCoach, isPhoneViewport, mergeRects, shadeClipPath } from './placement';
import { useGuideFocusStore, GuideFocusContext } from './guideFocusStore';

/** Rects the coach must not cover: tagged elements (primary CTA, Guidance control) and the corner stack (toasts/Report). */
const AVOID_SELECTOR = '[data-guidance-avoid], [data-testid="corner-stack"] > *';
/** A modal or player layer is open: the portal coach would paint over its backdrop. */
const BLOCKING_LAYER = '[aria-modal="true"], [role="dialog"], [data-player-layer]';
/** A parked drawer (visibility:hidden, off-screen) is not an open layer. */
const isShown = el => el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : getComputedStyle(el).visibility !== 'hidden';
const layerIsOpen = () => [...document.querySelectorAll(BLOCKING_LAYER)].some(isShown);
/** The docked coach sits in a strip ABOVE the action band so it never covers the CTA it describes. */
const ACTION_BAND = '[data-testid="action-band"]';
/** T12580: the Guidance switch stays clickable under the shade. */
const SHADE_ALWAYS_CLEAR = '[data-testid="guidance-toggle"]';
const SHADE_PAD = 6;
/** Progress and error steps have nothing to press: dialog only. */
const NO_SHADE_TONES = ['progress', 'error'];
const dockBottomOffset = () => {
  const band = visibleRects(ACTION_BAND).find(r => r.top < innerHeight);
  return band ? Math.round(innerHeight - band.top + 8) : 12;
};
const visibleRects = selector => [...document.querySelectorAll(selector)].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
/** Shared floating host. Observers exist only while guidance is enabled. */
function ActiveCoach({ children, target, fallbackTarget, side = 'top', phase, avoid = [], guideId, tone = 'coach', keepClear = [] }) {
  const avoidKey = avoid.join(',');
  const keepClearKey = keepClear.join(',');
  const focusable = !!guideId && !NO_SHADE_TONES.includes(tone);
  const acknowledge = useGuideFocusStore(s => s.acknowledge);
  const [cuts, setCuts] = useState(null);
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const [scrollDirection, setScrollDirection] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [dockBottom, setDockBottom] = useState(12);
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
      setDockBottom(dockBottomOffset());
      const layerOpen = layerIsOpen();
      setBlocked(old => old === layerOpen ? old : layerOpen);
      // T12580: shade only when the anchor is really on screen and no modal layer is open (never trap the user).
      let nextCuts = null;
      if (focusable && !layerOpen && !targetOffscreen && rect && rect.width && rect.height) {
        const pad = r => ({ left: r.left - SHADE_PAD, top: Math.max(0, r.top - SHADE_PAD), right: r.right + SHADE_PAD, bottom: r.bottom + SHADE_PAD });
        const extra = [...(keepClearKey ? keepClearKey.split(',') : []), SHADE_ALWAYS_CLEAR].flatMap(visibleRects);
        nextCuts = JSON.stringify(mergeRects([pad(rect), ...extra.map(pad)]));
      }
      setCuts(old => old === nextCuts ? old : nextCuts);
      if (!card) { setPosition(null); return; }
      // Target and fallback both missing: dock in the reserved strip rather than staying hidden.
      if (!rect || !rect.width || !rect.height) { setPosition(old => old === 'dock' ? old : 'dock'); return; }
      const next = isPhoneViewport(innerWidth)
        ? 'dock'
        : placeCoach(rect, card.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, side, visibleRects(avoidKey ? `${AVOID_SELECTOR}, ${avoidKey}` : AVOID_SELECTOR));
      setPosition(old => old === next || (old && next !== 'dock' && old !== 'dock' && old.left === next.left && old.top === next.top) ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? { observe() {}, disconnect() {} } : new ResizeObserver(schedule);
    if (ref.current) observer.observe(ref.current);
    for (const selector of [target, fallbackTarget].filter(Boolean)) {
      const anchor = document.querySelector(selector); if (anchor) observer.observe(anchor);
    }
    measure(); schedule();
    const layerObserver = typeof MutationObserver === 'undefined' ? { observe() {}, disconnect() {} } : new MutationObserver(schedule);
    layerObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); layerObserver.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [target, fallbackTarget, side, phase, avoidKey, focusable, keepClearKey]);
  useEffect(() => {
    if (!focusable || blocked) return undefined;
    const onKey = e => { if (e.key === 'Escape') acknowledge(guideId); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusable, blocked, guideId, acknowledge]);
  const focusValue = useMemo(() => focusable ? { guideId, acknowledge: () => acknowledge(guideId) } : null, [focusable, guideId, acknowledge]);
  const docked = position === 'dock';
  const hidden = blocked || !position;
  const cutRects = cuts && !hidden ? JSON.parse(cuts) : null;
  return createPortal(<>
    {cutRects && <div data-testid="guide-shade" data-cutouts={cuts}
      className={`fixed inset-0 ${Z.POPOVER} bg-black/40 backdrop-blur-sm backdrop-brightness-75`}
      style={{ clipPath: shadeClipPath({ width: innerWidth, height: innerHeight }, cutRects) }} />}
    <div ref={ref} data-testid="floating-coach-host" data-docked={docked ? 'true' : undefined}
    className={`fixed ${Z.POPOVER} pointer-events-none [&_button]:pointer-events-auto ${docked ? 'inset-x-3 w-auto' : 'w-[min(calc(100vw-24px),26rem)]'}`}
    style={{ ...(docked ? { bottom: dockBottom } : position), visibility: hidden ? 'hidden' : 'visible' }}>
      <GuideFocusContext.Provider value={focusValue}>{children}</GuideFocusContext.Provider>
    </div>
    {scrollDirection && !blocked && <div data-testid="guidance-scroll-hint" className={`fixed left-1/2 z-[109] -translate-x-1/2 rounded-full border border-amber-300/70 bg-gray-950/95 px-3 py-2 text-amber-200 shadow-xl ${scrollDirection === 'down' ? 'bottom-4' : 'top-4'}`}>
      {scrollDirection === 'down' ? <ChevronDown size={20} aria-label="Scroll down to find the guided action" /> : <ChevronUp size={20} aria-label="Scroll up to find the guided action" />}
    </div>}
  </>, document.body);
}
export default function FloatingCoach(props) {
  const { coachEnabled } = useGuidanceSettings();
  // T12580: an acknowledged rule renders nothing (no dialog, shade, observers) until the rule changes.
  const acknowledged = useGuideFocusStore(s => !!props.guideId && !!s.acked[props.guideId]);
  return coachEnabled && !acknowledged ? <ActiveCoach {...props} /> : null;
}
