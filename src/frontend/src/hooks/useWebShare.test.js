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

  it('reports isMobile on a coarse-pointer device (native share path), independent of UA string', () => {
    mockPointer({ coarse: true });
    navigator.share = vi.fn().mockResolvedValue();
    const { result } = renderHook(() => useWebShare());
    expect(result.current.isMobile).toBe(true);
  });

  it('computes LINK_ONLY capability on a coarse-pointer device with no file-share support', () => {
    mockPointer({ coarse: true });
    navigator.share = vi.fn().mockResolvedValue();
    navigator.canShare = undefined;
    const { result } = renderHook(() => useWebShare());
    expect(result.current.capability).toBe(ShareCapability.LINK_ONLY);
  });

  it('computes FULL capability on a coarse-pointer device when canShare({files}) is supported', () => {
    mockPointer({ coarse: true });
    navigator.share = vi.fn().mockResolvedValue();
    navigator.canShare = vi.fn(() => true);
    const { result } = renderHook(() => useWebShare());
    expect(result.current.capability).toBe(ShareCapability.FULL);
  });
});

// T11510 (Social Cover Image epic): a file and a link are two different
// shares, so they are two separate functions with two separate payload
// shapes -- neither branches on capability itself (the caller picks which to
// offer). shareVideoFile sends ONLY files; shareLink sends ONLY a url. A
// regression here (one function sending both, or the wrong one) is exactly
// the bug this task fixes: a mobile "Share link" button that silently sent
// the video file instead, so the user's chosen cover never reached iMessage.
describe('useWebShare.shareVideoFile / shareLink (T11510 split payloads)', () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    mockShareResponse();
    navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };
  });

  afterEach(() => {
    navigator.share = originalShare;
    navigator.clipboard = originalClipboard;
  });

  it('shareVideoFile calls navigator.share with files and NO url', async () => {
    navigator.share = vi.fn().mockResolvedValue();
    // fetchReelDownload: first apiFetch resolves file-url (non-proxied -> a
    // presigned R2 url), then a raw fetch() retrieves the bytes.
    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: 'https://r2.example/presigned', filename: 'highlight.mp4', proxied: false }),
    }));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['bytes'], { type: 'video/mp4' }),
    });
    const { result } = renderHook(() => useWebShare());

    await act(async () => {
      await result.current.shareVideoFile({
        downloadId: 1, title: 't', text: 'x', filename: 'highlight.mp4',
      });
    });

    expect(navigator.share).toHaveBeenCalledTimes(1);
    const payload = navigator.share.mock.calls[0][0];
    expect(payload.url).toBeUndefined();
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]).toBeInstanceOf(File);
    expect(payload.files[0].name).toBe('highlight.mp4');
  });

  it('shareLink calls navigator.share with url and NO files', async () => {
    navigator.share = vi.fn().mockResolvedValue();
    const { result } = renderHook(() => useWebShare());

    await act(async () => {
      await result.current.shareLink({
        url: 'https://reelballers.com/shared/tok123', title: 't', text: 'x',
      });
    });

    expect(navigator.share).toHaveBeenCalledTimes(1);
    const payload = navigator.share.mock.calls[0][0];
    expect(payload.files).toBeUndefined();
    expect(payload.url).toBe('https://reelballers.com/shared/tok123');
  });
});

// T10180: link-ready needs to SHOW the share URL before any copy, so copyLink's
// create-and-immediately-copy shape can't drive it. createShareLink({ downloadId })
// mints/reuses the token and RETURNS the url string with NO clipboard write --
// additive, existing copyLink/webShare unchanged for other surfaces (design §2.4).
describe('useWebShare.createShareLink (T10180 additive create-that-returns-URL)', () => {
  const originalMatchMedia = window.matchMedia;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    mockShareResponse('tok456');
    navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };
    mockPointer({ coarse: false });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    navigator.clipboard = originalClipboard;
  });

  it('returns the share URL string and does NOT write to the clipboard', async () => {
    const { result } = renderHook(() => useWebShare());

    let url;
    await act(async () => {
      url = await result.current.createShareLink({ downloadId: 99 });
    });

    expect(url).toBe(`${window.location.origin}/shared/tok456`);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('mints via the same single-video share endpoint as copyLink (gesture-driven token create)', async () => {
    const { result } = renderHook(() => useWebShare());

    await act(async () => {
      await result.current.createShareLink({ downloadId: 99 });
    });

    expect(globalThis.apiFetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/gallery\/99\/share$/),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// T10860 (design §2.3/§5): repointShareLink({ downloadId, shareToken }) POSTs
// the new /share/repoint endpoint and returns { shareUrl, changed } on
// success -- `changed` distinguishes an idempotent no-op (already current)
// from a real re-point, since both return the same ok/share_url shape
// otherwise. On failure it throws an Error carrying `.code` (video_not_current
// | target_missing | repoint_conflict | share_project_mismatch) when the
// backend sent one, and always carries `.status` (the plain-HTTPException
// refusals -- 404/403/400/410 -- have no `code` field at all).
describe('useWebShare.repointShareLink (T10860)', () => {
  const originalMatchMedia = window.matchMedia;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };
    mockPointer({ coarse: false });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    navigator.clipboard = originalClipboard;
  });

  it('POSTs /api/gallery/{downloadId}/share/repoint with the share_token body and returns { shareUrl, changed }', async () => {
    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, share_url: 'https://reelballers.com/shared/stale-tok', changed: true }),
    }));
    const { result } = renderHook(() => useWebShare());

    let outcome;
    await act(async () => {
      outcome = await result.current.repointShareLink({ downloadId: 99, shareToken: 'stale-tok' });
    });

    expect(outcome).toEqual({ shareUrl: 'https://reelballers.com/shared/stale-tok', changed: true });
    expect(globalThis.apiFetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/gallery\/99\/share\/repoint$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ share_token: 'stale-tok' }),
      }),
    );
  });

  it('returns changed: false on the idempotent no-op (already current)', async () => {
    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, share_url: 'https://reelballers.com/shared/stale-tok', changed: false }),
    }));
    const { result } = renderHook(() => useWebShare());

    let outcome;
    await act(async () => {
      outcome = await result.current.repointShareLink({ downloadId: 99, shareToken: 'stale-tok' });
    });

    expect(outcome.changed).toBe(false);
  });

  it('throws an Error carrying the response `code` on failure (e.g. target_missing)', async () => {
    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: 'target_missing', detail: 'The re-exported video is not ready yet.' }),
    }));
    const { result } = renderHook(() => useWebShare());

    let caught;
    await act(async () => {
      try {
        await result.current.repointShareLink({ downloadId: 99, shareToken: 'stale-tok' });
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect(caught.code).toBe('target_missing');
    expect(caught.status).toBe(409);
  });

  it('throws an Error carrying `.status` but no `.code` for a plain-HTTPException refusal (e.g. 410 revoked)', async () => {
    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: false,
      status: 410,
      json: async () => ({ detail: 'This share has been revoked' }),
    }));
    const { result } = renderHook(() => useWebShare());

    let caught;
    await act(async () => {
      try {
        await result.current.repointShareLink({ downloadId: 99, shareToken: 'stale-tok' });
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect(caught.status).toBe(410);
    expect(caught.code).toBeUndefined();
  });
});
