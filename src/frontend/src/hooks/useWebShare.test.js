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

function mockShareResponse(downloadId = 1, token = 'tok123') {
  globalThis.fetch = undefined;
  globalThis.apiFetchImpl = vi.fn(async () => ({
    ok: true,
    json: async () => ({ shares: [{ share_token: token }] }),
  }));
}

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

describe('useWebShare capability gating (T5220 desktop-share regression)', () => {
  const originalUserAgent = navigator.userAgent;
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    mockShareResponse();
    navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
    navigator.share = originalShare;
    navigator.clipboard = originalClipboard;
  });

  it('computes NONE capability on a desktop UA even when navigator.share exists', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      configurable: true,
    });
    navigator.share = vi.fn();
    const { result } = renderHook(() => useWebShare());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.capability).toBe(ShareCapability.NONE);
  });

  it('webShare() on desktop never calls navigator.share, falls back to clipboard', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      configurable: true,
    });
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

  it('webShare() on mobile with LINK_ONLY capability does call navigator.share', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
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
});
