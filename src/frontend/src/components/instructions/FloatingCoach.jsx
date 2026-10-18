import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useGuidanceSettings } from '../../stores/settingsStore';

import { Z } from '../../constants/zLayers';
import { placeCoach, dockPlacement, isPhoneViewport, mergeRects, shadeClipPath, bandsCollide, clearOfPulses, coveredTargets } from './placement';
import { useGuideFocusStore, GuideFocusContext } from './guideFocusStore';
import { GUIDE_PULSE_CLASS } from './guideTargets';

/** Rects the coach must not cover: tagged elements (primary CTA, Guidance control) and the corner stack (toasts/Report). */
const AVOID_SELECTOR = '[data-guidance-avoid], [data-testid="corner-stack"] > *';
/** A modal or player layer is open: the portal coach would paint over its backdrop. */
const BLOCKING_LAYER = '[aria-modal="true"], [role="dialog"], [data-player-layer]';
/** A parked drawer (visibility:hidden, off-screen) is not an open layer. */
const isShown = el => el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : getComputedStyle(el).visibility !== 'hidden';
/** A layer that holds the guide's own anchor is the guide's screen (the Focus/Overlay ready panels and the Finished viewer live in a player layer), not a layer covering it. */
const layerIsOpen = anchor => [...document.querySelectorAll(BLOCKING_LAYER)].some(el => isShown(el) && !(anchor && el.contains(anchor)));
/** The docked coach sits in a strip ABOVE the action band so it never covers the CTA it describes. */
const ACTION_BAND = '[data-testid="action-band"]';
/** T12580: the Guidance switch stays clickable under the shade; so does the editor's Home/Back (leaving is always allowed). */
const SHADE_ALWAYS_CLEAR = '[data-testid="guidance-toggle"], [data-testid="editor-home"]';
/** A pulsing control is never shaded or covered by the card. */
const PULSING = `.${GUIDE_PULSE_CLASS}`;
const SHADE_PAD = 6;
/** Progress and error steps have nothing to press: dialog only. */
const NO_SHADE_TONES = ['progress', 'error'];
const dockBottomOffset = () => {
  const band = visibleRects(ACTION_BAND).find(r => r.top < innerHeight);
  return band ? Math.round(innerHeight - band.top + 8) : 12;
};
const GUIDE_LAYERS = '[data-testid="guide-shade"], [data-testid="floating-coach-host"], [data-testid="guidance-scroll-hint"]';
/**
 * T12800: the anchor's centre is under another page element (not the guide's own layers,
 * and not the anchor's own ancestor). jsdom has no hit-testing.
 * A `display: contents` anchor whose real boxes are several SIBLING elements (e.g.
 * annotate-highlight-slots' Portrait + Landscape cards, laid out as grid items of a
 * shared `grid` parent once `contents` drops out of the layout) has a union rect whose
 * CENTRE can legitimately fall in the GAP between those siblings -- elementFromPoint there
 * returns the shared grid/flex PARENT painting its own background, which is an ANCESTOR of
 * the anchor, not something covering it. `anchor.contains(top)` only checked the other
 * direction (is `top` a descendant); without `top.contains(anchor)` too, that parent read
 * as "covering" the anchor and the target was wrongly called offscreen, permanently (staging
 * 2026-10-15: "Scroll down to continue" stuck over a fully on-screen "Make a highlight" step).
 */
const coveredByPage = (anchor, rect) => {
  if (!anchor || typeof document.elementFromPoint !== 'function') return false;
  const x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return !!top && top !== anchor && !anchor.contains(top) && !top.contains(anchor) && !top.closest(GUIDE_LAYERS);
};
/**
 * A `display: contents` anchor has no box of its own: measure the union of its children.
 * T12800: recurses -- a child that is ITSELF `display: contents` (a nested inline wrapper,
 * e.g. HighlightOrientationSlots renders two levels of `contents` when `inline`) is walked
 * into rather than filtered out for having a zero rect of its own, or the union silently
 * comes back empty and the caller falls back as if the anchor were entirely missing.
 */
const anchorRect = el => {
  if (!el) return undefined;
  const own = el.getBoundingClientRect();
  if ((own.width && own.height) || getComputedStyle(el).display !== 'contents') return own;
  const kids = [...el.children].map(anchorRect).filter(r => r && r.width && r.height);
  if (!kids.length) return own;
  const left = Math.min(...kids.map(r => r.left)), top = Math.min(...kids.map(r => r.top));
  const right = Math.max(...kids.map(r => r.right)), bottom = Math.max(...kids.map(r => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};
/**
 * T12800: the real, box-having element(s) under `el` -- itself, or (recursively) its children
 * when `el` is `display: contents` and so never resizes as a box of its own. A ResizeObserver
 * on a `display: contents` anchor directly NEVER FIRES as its real content grows or shrinks
 * (its own border box is permanently 0x0), so a stale "offscreen" measurement taken on an
 * early, unsettled render (e.g. right as a step mounts) can never self-correct: nothing ever
 * tells `measure()` to run again. Staging 2026-10-15: annotate-highlight-slots (inline,
 * `display: contents` two levels deep) got stuck showing "Scroll down to continue" over
 * fully on-screen content, permanently, because of exactly this.
 */
const realBoxes = el => {
  if (!el) return [];
  if (getComputedStyle(el).display !== 'contents') return [el];
  return [...el.children].flatMap(realBoxes);
};
/** Name a touch target for the overlap oracle: its testid, else its tag. */
const targetName = el => el.dataset?.testid || el.tagName.toLowerCase();
const namedRects = selector => [...document.querySelectorAll(selector)].map(e => ({ name: targetName(e), rect: e.getBoundingClientRect() })).filter(t => t.rect.width && t.rect.height);
const visibleRects = selector => [...document.querySelectorAll(selector)].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
/**
 * The page's own scrollers (an inner `overflow-auto` column, not the window): the portal shade is not
 * their descendant, so wheel/touch over it never scrolls them and it paints over their scrollbar.
 * Only viewport-sized scrollers count, not a small list or drawer.
 */
const pageScrollers = () => [...document.querySelectorAll('[class*="overflow-"]')].filter(el => {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const oy = getComputedStyle(el).overflowY;
  if (oy !== 'auto' && oy !== 'scroll') return false;
  const r = el.getBoundingClientRect();
  return r.width >= innerWidth / 2 && r.height >= innerHeight / 2;
});
const largestScroller = () => pageScrollers().sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
/** A classic scrollbar's gutter: cut out of the shade so it stays visible and draggable. */
const scrollbarGutters = () => pageScrollers().flatMap(el => {
  const gutter = el.offsetWidth - el.clientWidth;
  const r = el.getBoundingClientRect();
  return gutter > 0 ? [{ left: r.right - gutter, right: r.right, top: r.top, bottom: r.bottom, width: gutter, height: r.height }] : [];
});
/** Shared floating host. Observers exist only while guidance is enabled. */
function ActiveCoach({ children, target, fallbackTarget, side = 'top', phase, avoid = [], guideId, tone = 'coach', keepClear = [], shadeClear = [], end = false, gotIt = true }) {
  const avoidKey = avoid.join(',');
  const keepClearKey = keepClear.join(',');
  const shadeClearKey = shadeClear.join(',');
  const focusable = !!guideId && !NO_SHADE_TONES.includes(tone);
  const acknowledge = useGuideFocusStore(s => s.acknowledge);
  const [cuts, setCuts] = useState(null);
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const [scrollDirection, setScrollDirection] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [dockBottom, setDockBottom] = useState(12);
  const [overlap, setOverlap] = useState(null);
  const [shadeScrollsThrough, setShadeScrollsThrough] = useState(false);
  const warnedRef = useRef('');
  const touchY = useRef(null);
  // The shade captures pointer events over its shaded area, so hand wheel/touch scrolling to the page's scroller.
  const forwardWheel = e => largestScroller()?.scrollBy({ top: e.deltaY, left: e.deltaX });
  const forwardTouchStart = e => { touchY.current = e.touches[0].clientY; };
  const forwardTouchMove = e => {
    const y = e.touches[0].clientY;
    if (touchY.current !== null) largestScroller()?.scrollBy({ top: touchY.current - y });
    touchY.current = y;
  };
  useLayoutEffect(() => {
    let raf;
    const measure = () => {
      const card = ref.current;
      let anchor = document.querySelector(target);
      let rect = anchorRect(anchor);
      // T12800: off-screen means less than half of it is in the viewport, or its centre sits under something
      // that is not the guide (a sticky header it scrolled beneath). A target mostly in view (Done at the foot
      // of the play editor at 1280x800, Home's tabs at the very top) keeps its cutout, and the scroll hint,
      // which docks at an edge, never sits on it.
      const visibleH = rect ? Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0) : 0;
      const targetOffscreen = rect && rect.width && rect.height && (visibleH < rect.height / 2 || coveredByPage(anchor, rect));
      if (targetOffscreen) setScrollDirection(rect.top + rect.height / 2 > innerHeight / 2 ? 'down' : 'up');
      else setScrollDirection(null);
      if ((!rect || targetOffscreen) && fallbackTarget) {
        anchor = document.querySelector(fallbackTarget); rect = anchorRect(anchor);
      }
      setDockBottom(dockBottomOffset());
      const layerOpen = layerIsOpen(anchor);
      setBlocked(old => old === layerOpen ? old : layerOpen);
      // T12580: a modal layer open behind the coach owns its own backdrop (never double-shade).
      // T12800: otherwise the shade is a GUARANTEE while focusable, not a best-effort -- if the anchor
      // can't be measured (a selector mismatch, a display:contents case anchorRect's recursion doesn't
      // cover) OR it's offscreen (needs a scroll), that is "we don't know what to carve a hole around
      // right now", never "shade nothing". An active, focusable guide with no shade silently drops the
      // one promise the shade exists to keep: that everything but the named control is out of reach.
      // `[]` holes -> a full, hole-less shade, and it is ALWAYS `pointer-events: none` (scrollsThrough):
      // staging 2026-10-15 found this fallback firing on an ordinary, on-screen, momentarily-unsettled
      // measurement (not just the offscreen/display:contents cases it was built for) and capturing clicks
      // across the WHOLE page -- a much worse regression (the page reads as frozen) than the missing dim
      // it replaced. The fallback is a safety net for "we don't know what to carve a hole around", not a
      // claim that nothing underneath is real; it must never be able to block real interaction. The
      // precise, measured cutout above is the ONLY case allowed to capture pointer events.
      let nextCuts = null;
      let scrollsThrough = false;
      if (focusable && !layerOpen) {
        const pad = r => ({ left: r.left - SHADE_PAD, top: Math.max(0, r.top - SHADE_PAD), right: r.right + SHADE_PAD, bottom: r.bottom + SHADE_PAD });
        const extra = [...(keepClearKey ? keepClearKey.split(',') : []), ...(shadeClearKey ? shadeClearKey.split(',') : []), SHADE_ALWAYS_CLEAR, PULSING].flatMap(visibleRects).concat(scrollbarGutters());
        if (!targetOffscreen && rect && rect.width && rect.height) {
          nextCuts = JSON.stringify(mergeRects([pad(rect), ...extra.map(pad)]));
        } else {
          // No measurable on-screen anchor: no hole for it, but whatever the step keeps clear and IS on
          // screen stays bright (Annotate watch at 1600x900: Mark play is below the fold, and the video
          // and Play it also names were dimmed with everything else).
          nextCuts = JSON.stringify(mergeRects(extra.map(pad)));
          scrollsThrough = true;
        }
      }
      setCuts(old => old === nextCuts ? old : nextCuts);
      setShadeScrollsThrough(old => old === scrollsThrough ? old : scrollsThrough);
      if (!card) { setPosition(null); return; }
      // Target and fallback both missing: dock in the reserved strip rather than staying hidden.
      if (!rect || !rect.width || !rect.height) { setPosition(old => old === 'dock' ? old : 'dock'); return; }
      // What the step tells the user to touch: its pulsing controls and its keep-clear rects. The card never covers them.
      const touchRects = [PULSING, ...(keepClearKey ? keepClearKey.split(',') : [])].flatMap(visibleRects);
      const avoidRects = [...visibleRects(avoidKey ? `${AVOID_SELECTOR}, ${avoidKey}` : AVOID_SELECTOR), ...touchRects];
      const placed = isPhoneViewport(innerWidth)
        ? 'dock'
        : placeCoach(rect, card.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, side, avoidRects);
      // A bottom dock that would sit on a control the step names moves to the top of the anchor instead.
      const cardH = card.getBoundingClientRect().height;
      const dockSlot = { left: 0, right: innerWidth, top: innerHeight - dockBottomOffset() - cardH, bottom: innerHeight - dockBottomOffset() };
      const avoidCollides = placed === 'dock' && avoidKey && visibleRects(avoidKey).some(r => bandsCollide(dockSlot, r));
      // T12650: a bottom dock that would sit on the anchor itself moves above it.
      const viewport = { width: innerWidth, height: innerHeight };
      const chosen = avoidCollides
        ? { left: 12, top: Math.max(56, Math.round(rect.top + 8)), dockTop: true }
        : placed === 'dock' ? dockPlacement(rect, cardH, viewport, dockBottomOffset()) : placed;
      const cardBox = card.getBoundingClientRect();
      const place = keepOut => clearOfPulses(chosen, { anchor: rect, card: cardBox, viewport, bottomOffset: dockBottomOffset(), keepOut, floatFirst: side === 'beside' });
      // shadeClear rects (the play editor's video) are a placement PREFERENCE: use a slot that clears them too when one exists, else
      // fall back to clearing only what the step names (a preference must never push the card onto Done).
      const preferredRects = shadeClearKey ? shadeClearKey.split(',').flatMap(visibleRects) : [];
      const hardTargets = [PULSING, ...(keepClearKey ? keepClearKey.split(',') : [])].flatMap(namedRects);
      const preferredNames = shadeClearKey ? shadeClearKey.split(',').flatMap(namedRects) : [];
      const soft = preferredRects.length ? place([...avoidRects, ...preferredRects]) : null;
      const softClear = soft && !coveredTargets(soft, cardBox, viewport, dockBottomOffset(), [...hardTargets, ...preferredNames]).length;
      const next = softClear ? soft : place(touchRects);
      // T12800: the oracle. Whatever the card still covers is named on the host (the Playwright sweep reads it) and logged once per placement.
      const covered = [...new Set(coveredTargets(next, cardBox, viewport, dockBottomOffset(), hardTargets))].join(',');
      setOverlap(covered || null);
      const warnKey = covered && `${guideId}|${JSON.stringify(next)}|${covered}`;
      if (warnKey && warnKey !== warnedRef.current) console.warn('[guide-overlap]', guideId, covered);
      warnedRef.current = warnKey || '';
      setPosition(old => old === next || (old && next !== 'dock' && old !== 'dock' && old.left === next.left && old.top === next.top) ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? { observe() {}, disconnect() {} } : new ResizeObserver(schedule);
    if (ref.current) observer.observe(ref.current);
    for (const selector of [target, fallbackTarget].filter(Boolean)) {
      const anchor = document.querySelector(selector);
      // T12800: observe the REAL box(es), not a display:contents anchor directly (see realBoxes).
      for (const box of realBoxes(anchor)) observer.observe(box);
    }
    measure(); schedule();
    const layerObserver = typeof MutationObserver === 'undefined' ? { observe() {}, disconnect() {} } : new MutationObserver(schedule);
    layerObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); layerObserver.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [target, fallbackTarget, side, phase, avoidKey, focusable, keepClearKey, shadeClearKey, guideId]);
  useEffect(() => {
    if (!focusable || blocked || end) return undefined;
    // T12690: capture + stopPropagation so the Esc that dismisses the guide never also closes the screen behind it.
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); acknowledge(guideId); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusable, blocked, end, guideId, acknowledge]);
  // Progress/error cards are unshaded but still dismissible with Got it; only a Focused (shaded) step grabs keyboard focus.
  // An END card (nothing follows it) has no Got it and ignores Esc: X (turn guidance off) is the only way out.
  const focusValue = useMemo(() => guideId && gotIt ? { guideId, grabFocus: focusable, acknowledge: () => acknowledge(guideId) } : null, [focusable, gotIt, guideId, acknowledge]);
  const docked = position === 'dock' || !!position?.dockTop;
  const hidden = blocked || !position;
  const cutRects = cuts && !hidden ? JSON.parse(cuts) : null;
  return createPortal(<>
    {cutRects && <div data-testid="guide-shade" data-cutouts={cuts} data-scrolls-through={shadeScrollsThrough ? 'true' : undefined}
      onWheel={forwardWheel} onTouchStart={forwardTouchStart} onTouchMove={forwardTouchMove}
      className={`fixed inset-0 ${Z.POPOVER} bg-black/40 backdrop-blur-sm backdrop-brightness-75 ${shadeScrollsThrough ? 'pointer-events-none' : ''}`}
      style={{ clipPath: shadeClipPath({ width: innerWidth, height: innerHeight }, cutRects) }} />}
    <div ref={ref} data-testid="floating-coach-host" data-docked={docked ? 'true' : undefined} data-guide-overlap={overlap && !hidden ? overlap : undefined}
    // T12800: a docked card (bottom strip or dockTop) used to span edge-to-edge (inset-x-3 w-auto), so a
    // short one-line guide read as a near-full-width bar on wide viewports. Cap and centre it like the
    // floating card instead; it still docks to the strip vertically via the `style` below.
    className={`fixed ${Z.POPOVER} pointer-events-none [&_button]:pointer-events-auto w-[min(calc(100vw-24px),26rem)] ${docked ? 'left-1/2 -translate-x-1/2' : ''}`}
    style={{ ...(position?.dockTop ? { top: position.top } : docked ? { bottom: dockBottom } : position), visibility: hidden ? 'hidden' : 'visible' }}>
      <GuideFocusContext.Provider value={focusValue}>{children}</GuideFocusContext.Provider>
    </div>
    {/* T12800: z-matches the shade (not z-[109], one below) and renders after it in the DOM -- the shade
        now also covers the offscreen case (scrollsThrough), and the hint must stay visible above it. */}
    {scrollDirection && !blocked && <div data-testid="guidance-scroll-hint" className={`fixed left-1/2 ${Z.POPOVER} flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-amber-300/70 bg-gray-950/95 px-3 py-2 text-sm font-medium text-amber-200 shadow-xl ${scrollDirection === 'down' ? 'bottom-4' : 'top-4'}`}>
      {scrollDirection === 'down' ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
      {scrollDirection === 'down' ? 'Scroll down to continue' : 'Scroll up to continue'}
    </div>}
  </>, document.body);
}
export default function FloatingCoach(props) {
  const { coachEnabled } = useGuidanceSettings();
  // T12580: an acknowledged rule renders nothing (no dialog, shade, observers) until the rule changes.
  const acknowledged = useGuideFocusStore(s => !!props.guideId && !!s.acked[props.guideId]);
  return coachEnabled && !acknowledged ? <ActiveCoach {...props} /> : null;
}
