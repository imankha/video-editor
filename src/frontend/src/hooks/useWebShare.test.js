import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebShare, ShareCapability } from './useWebShare';

// Bug found live-testing T5220 (2026-08-08): on a desktop browser that
// exposes navigator.share() for URL-only shares (some Chromium/Edge builds
// do, even without touch), webShare() used to check the raw feature
// (`if (navigator.share)`) instead of the already-isMobile-gated
// `capability` value -- popping the bare OS share sheet on desktop instead
// of respecting the mobile-only capability the hook computed. It must gate
// on `capability !== NONE`, not raw feature detection.
//
// T7350 (2026-08-20): the mobile-vs-desktop signal itself moved OFF a
// navigator.userAgent regex (which misclassified in-app webviews / desktop-
// site mode as desktop, silently killing native share on real phones) and ONTO
// the `(pointer: coarse)` matchMedia capability check ReelTile/DraftTile
// already use. These tests mock matchMedia (coarse => mobile, fine => desktop),
// NOT the UA string, to pin that mechanism. The T5220 desktop assertions below
// stay green under it: a fine-pointer desktop is NONE even with navigator.share.

function mockShareResponse(token = 'tok123') {
  globalThis.fetch = undefined;
  globalThis.apiFetchImpl = vi.fn(async () => ({
    ok: true,
    json: async () => ({ shares: [{ share_token: token }] }),
  }));
}

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

// Mock window.matchMedia so useIsCoarsePointer() reports the desired device.
// `coarse: true` => a touch/pen primary pointer (phone/tablet); `false` => a
// fine mouse pointer (desktop). Only the `(pointer: coarse)` query matters here.
function mockPointer({ coarse }) {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('pointer: coarse') ? coarse : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

describe('useWebShare capability gating (T5220 desktop-share regression, T7350 pointer-capability)', () => {
  const originalMatchMedia = window.matchMedia;
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    mockShareResponse();
    navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    navigator.share = originalShare;
    navigator.clipboard = originalClipboard;
  });

  it('computes NONE capability on a fine-pointer desktop even when navigator.share exists', () => {
    mockPointer({ coarse: false });
    navigator.share = vi.fn();
    const { result } = renderHook(() => useWebShare());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.capability).toBe(ShareCapability.NONE);
  });

  it('webShare() on a fine-pointer desktop never calls navigator.share, falls back to clipboard', async () => {
    mockPointer({ coarse: false });
    navigator.share = vi.fn().mockResolvedValue();
    const { result } = renderHook(() => useWebShare());

    let method;
    await act(async () => {
      method = await result.current.webShare({ downloadId: 1, title: 't', text: 'x', filename: 'f.mp4' });
    });

    expect(navigator.share).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(method).toBe('clipboard');
  });

  it('reports isMobile on a coarse-pointer device (native share path), independent of UA string', () => {
    mockPointer({ coarse: true });
    navigator.share = vi.fn().mockResolvedValue();
    const { result } = renderHook(() => useWebShare());
    expect(result.current.isMobile).toBe(true);
  });

  it('webShare() on a coarse-pointer device with LINK_ONLY capability does call navigator.share', async () => {
    mockPointer({ coarse: true });
    navigator.share = vi.fn().mockResolvedValue();
    navigator.canShare = undefined;
    const { result } = renderHook(() => useWebShare());
    expect(result.current.capability).toBe(ShareCapability.LINK_ONLY);

    let method;
    await act(async () => {
      method = await result.current.webShare({ downloadId: 1, title: 't', text: 'x', filename: 'f.mp4' });
    });

    expect(navigator.share).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't', text: 'x' })
    );
    expect(method).toBe('link');
  });

  it('computes FULL capability on a coarse-pointer device when canShare({files}) is supported', () => {
    mockPointer({ coarse: true });
    navigator.share = vi.fn().mockResolvedValue();
    navigator.canShare = vi.fn(() => true);
    const { result } = renderHook(() => useWebShare());
    expect(result.current.capability).toBe(ShareCapability.FULL);
  });
});
