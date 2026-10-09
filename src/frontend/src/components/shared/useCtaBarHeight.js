import { useLayoutEffect } from 'react';

/**
 * Publishes a bar's rendered height as --cta-bar-h on documentElement (view-only,
 * never persisted) so content above a sticky bar can cap itself to the space the
 * bar leaves. Cleared on unmount.
 */
export default function useCtaBarHeight(ref, enabled = true) {
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return undefined;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--cta-bar-h', `${ref.current.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(ref.current);
    return () => { ro?.disconnect(); root.style.removeProperty('--cta-bar-h'); };
  }, [ref, enabled]);
}
