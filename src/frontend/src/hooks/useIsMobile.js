import { useState, useEffect } from 'react';

// Detect mobile: either narrow viewport OR touch-primary device without hover (phones/tablets)
const MOBILE_QUERY = '(max-width: 1023px), ((hover: none) and (pointer: coarse))';

// Detect phone-sized landscape (tablets in landscape have enough height for normal layout)
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
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
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(LANDSCAPE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    const handler = (e) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isLandscape;
}

// Phone-WIDTH portrait (T11570 Spotlight pick guide): distinguishes a phone from a
// tablet within the "mobile" bucket, where useIsMobile's 1023px threshold covers
// both. Portrait-gated so a landscape phone (handled by useIsLandscape) isn't
// double-matched.
const PHONE_PORTRAIT_QUERY = '(max-width: 640px) and (orientation: portrait)';

export function useIsPhonePortrait() {
  const [isPhonePortrait, setIsPhonePortrait] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(PHONE_PORTRAIT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(PHONE_PORTRAIT_QUERY);
    const handler = (e) => setIsPhonePortrait(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isPhonePortrait;
}

// The smallest phones (T11570): width AND height both small enough that even the
// phone-portrait guide strip must drop its sub-line and compact its step count.
const SMALL_PHONE_QUERY = '(max-width: 360px) and (max-height: 700px)';

export function useIsSmallPhoneViewport() {
  const [isSmallPhone, setIsSmallPhone] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(SMALL_PHONE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(SMALL_PHONE_QUERY);
    const handler = (e) => setIsSmallPhone(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isSmallPhone;
}

// Detect the "cockpit" condition: a phone held sideways. A PURE derivation of the two
// hooks above (D1) — no state, no effect, no store field. When true, Focus renders its
// distinct landscape cockpit layout (full-bleed stage, edge rails, one timeline strip,
// no scroll) instead of the scrolling portrait/tablet layout. jsdom's matchMedia returns
// `matches: false`, so this is false in every jsdom unit test by construction.
export function useIsCockpit() {
  // Call both hooks unconditionally (rules-of-hooks); `&&` would short-circuit
  // the second call when the first is false.
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();
  return isMobile && isLandscape;
}
