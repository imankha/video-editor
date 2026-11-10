import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
import apiFetch from '../utils/apiFetch';
import { useDownloads } from './useDownloads';
import { useToastStore } from '../components/shared/Toast';

// T15520: a real download (cold build, no cache hit yet) can take 10s+ before
// any bytes move. The per-button spinner (T7100/T14170) is easy to miss on a
// small, demoted secondary button (e.g. the Finished player's Download
// button, T8540) -- add a toast at the START of downloadFile so feedback is
// unmissable within 1s regardless of which surface started the download.
const PRESIGNED = 'https://r2.example/reel.mp4?sig=x';

describe('useDownloads.downloadFile shows a toast immediately (T15520)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.getState().clearAll();
    global.URL.createObjectURL = vi.fn(() => 'blob:x');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('shows a toast synchronously, before the file-url request resolves', async () => {
    let resolveFileUrl;
    apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFileUrl = resolve;
        })
    );

    const { result } = renderHook(() => useDownloads(false));

    let downloadPromise;
    act(() => {
      downloadPromise = result.current.downloadFile(1);
    });

    // Still pending (apiFetch has not resolved) -- feedback must already be visible.
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);

    resolveFileUrl({
      ok: true,
      json: async () => ({ url: PRESIGNED, filename: 'R.mp4', proxied: false }),
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      blob: async () => new Blob(['x'], { type: 'video/mp4' }),
    }));

    await act(async () => {
      await downloadPromise;
    });

    // Dismissed once the download settles.
    expect(useToastStore.getState().toasts.length).toBe(0);
  });

  it('dismisses the toast even when the download fails', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    const { result } = renderHook(() => useDownloads(false));

    await expect(result.current.downloadFile(1)).rejects.toThrow(/Download failed/);
    expect(useToastStore.getState().toasts.length).toBe(0);
  });
});
