import { renderHook } from '@testing-library/react';
import { useIsCockpit, useIsMobile, useIsLandscape } from '../useIsMobile';

// Mock matchMedia so that MOBILE_QUERY and LANDSCAPE_QUERY can be toggled independently.
// MOBILE_QUERY:    '(max-width: 1023px), ((hover: none) and (pointer: coarse))'
// LANDSCAPE_QUERY: '(orientation: landscape) and (max-height: 500px)'
function mockMatchMedia({ mobile, landscape }) {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('orientation: landscape') ? landscape : mobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('useIsCockpit', () => {
  it('is true only when the device is BOTH mobile AND landscape (D1 derivation truth table)', () => {
    mockMatchMedia({ mobile: true, landscape: true });
    expect(renderHook(() => useIsCockpit()).result.current).toBe(true);

    mockMatchMedia({ mobile: true, landscape: false });
    expect(renderHook(() => useIsCockpit()).result.current).toBe(false);

    mockMatchMedia({ mobile: false, landscape: true });
    expect(renderHook(() => useIsCockpit()).result.current).toBe(false);

    mockMatchMedia({ mobile: false, landscape: false });
    expect(renderHook(() => useIsCockpit()).result.current).toBe(false);
  });

  it('is a pure derivation of useIsMobile && useIsLandscape', () => {
    mockMatchMedia({ mobile: true, landscape: true });
    const mobile = renderHook(() => useIsMobile()).result.current;
    const landscape = renderHook(() => useIsLandscape()).result.current;
    const cockpit = renderHook(() => useIsCockpit()).result.current;
    expect(cockpit).toBe(mobile && landscape);
  });

  it('does not throw and returns false when matchMedia is missing (hardened guard)', () => {
    const original = window.matchMedia;
    // eslint-disable-next-line no-undef
    delete window.matchMedia;
    expect(() => renderHook(() => useIsLandscape())).not.toThrow();
    expect(renderHook(() => useIsLandscape()).result.current).toBe(false);
    window.matchMedia = original;
  });
});
