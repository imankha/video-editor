import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '../../constants/zLayers';
import { GuideFocusContext } from './guideFocusStore';
import { placeBeside, BESIDE_CARD_WIDTH } from './placement';

/**
 * A dialog's guide card, shown beside the dialog (its `[data-guide-panel]` ancestor), level with
 * `anchorTarget`, never on or inside the control it describes. With no room beside the dialog
 * (a phone) or nothing measurable, it renders inline in place exactly as an inline Guide does.
 * Got it dismisses it for this mount only. View state; nothing is persisted.
 */
export default function BesideGuide({ guideId, anchorTarget, children }) {
  const markerRef = useRef(null);
  const cardRef = useRef(null);
  const [dismissed, setDismissed] = useState(false);
  const [spot, setSpot] = useState(null);
  const value = useMemo(() => ({ guideId, grabFocus: false, acknowledge: () => setDismissed(true) }), [guideId]);
  const beside = !!spot;
  useLayoutEffect(() => {
    let raf;
    const measure = () => {
      const panel = markerRef.current?.closest('[data-guide-panel]');
      const anchor = anchorTarget ? document.querySelector(anchorTarget) : null;
      const p = panel?.getBoundingClientRect(), a = anchor?.getBoundingClientRect();
      const next = p?.width && a?.height
        ? placeBeside(p, a, { width: BESIDE_CARD_WIDTH, height: cardRef.current?.getBoundingClientRect().height ?? 0 }, { width: innerWidth, height: innerHeight })
        : null;
      setSpot(old => (old === next || (old && next && old.left === next.left && old.top === next.top && old.side === next.side)) ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? { observe() {}, disconnect() {} } : new ResizeObserver(schedule);
    const panel = markerRef.current?.closest('[data-guide-panel]');
    if (panel) observer.observe(panel);
    if (cardRef.current) observer.observe(cardRef.current);
    measure(); schedule();
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); window.removeEventListener('resize', schedule); };
  }, [anchorTarget, guideId, dismissed, beside]);
  if (dismissed) return null;
  return (
    <GuideFocusContext.Provider value={value}>
      <span ref={markerRef} hidden />
      {spot
        ? createPortal(
          <div ref={cardRef} data-testid="beside-guide" data-side={spot.side} className={`fixed ${Z.POPOVER}`} style={{ left: spot.left, top: spot.top, width: BESIDE_CARD_WIDTH }}>{children}</div>,
          document.body,
        )
        : <div className="px-3 pb-2">{children}</div>}
    </GuideFocusContext.Provider>
  );
}
