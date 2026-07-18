import { useState, useEffect } from 'react';

// Detect mobile: either narrow viewport OR touch-primary device without hover (phones/tablets)
const MOBILE_QUERY = '(max-width: 1023px), ((hover: none) and (pointer: coarse))';

// Detect phone-sized landscape (tablets in landscape have enough height for normal layout)
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

// Detect a coarse (touch/pen) primary pointer — the gate for touch-only affordances
// like the overlay circle's select-then-manipulate step. Distinct from useIsMobile:
// a narrow *desktop* window is "mobile" by width but still has a fine mouse pointer,
// and must keep the byte-identical direct-drag behavior. Only `(pointer: coarse)`
// devices get the selection step.
const COARSE_QUERY = '(pointer: coarse)';

export function useIsCoarsePointer() {
  const [isCoarse, setIsCoarse] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(COARSE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(COARSE_QUERY);
    const handler = (e) => setIsCoarse(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isCoarse;
}

export function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(LANDSCAPE_QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    const handler = (e) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isLandscape;
}
