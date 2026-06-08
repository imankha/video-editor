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
