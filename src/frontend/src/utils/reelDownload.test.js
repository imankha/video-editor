import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchReelDownload } from './reelDownload';

// T14170: a reel download's bytes come from a presigned R2 URL, never through
// the API machine. apiFetch (credentialed, API origin) is only used to ask
// WHERE the file is; the MP4 itself is a plain cookie-less fetch of the URL.

vi.mock('./apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

const mp4 = (headers = {}) => ({
  ok: true, status: 200, statusText: 'OK',
  headers: new Headers({ 'Content-Type': 'video/mp4', ...headers }),
  blob: async () => new Blob(['MP4']),
});

describe('fetchReelDownload (T14170)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => mp4({ 'Content-Length': '3' }));
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches the bytes from the presigned R2 URL without cookies, not via the API', async () => {
    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: 'https://r2.example/signed', filename: 'Reel_ReelBallers.mp4', proxied: false }),
    }));

    const { response, filename } = await fetchReelDownload(7);

    expect(globalThis.apiFetchImpl).toHaveBeenCalledTimes(1);
    expect(globalThis.apiFetchImpl.mock.calls[0][0]).toMatch(/\/api\/downloads\/7\/file-url$/);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://r2.example/signed', { credentials: 'omit' });
    expect(filename).toBe('Reel_ReelBallers.mp4');
    expect(response.headers.get('Content-Length')).toBe('3');
  });

  it('uses the streaming /file endpoint when the backend says proxied (local storage)', async () => {
    globalThis.apiFetchImpl = vi.fn(async (url) => (
      url.endsWith('/file-url')
        ? { ok: true, json: async () => ({ url: null, filename: 'R.mp4', proxied: true }) }
        : mp4()
    ));

    const { filename } = await fetchReelDownload(7);

    expect(globalThis.apiFetchImpl.mock.calls[1][0]).toMatch(/\/api\/downloads\/7\/file$/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(filename).toBe('R.mp4');
  });

  it('throws when the URL lookup or the R2 fetch fails', async () => {
    globalThis.apiFetchImpl = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));
    await expect(fetchReelDownload(7)).rejects.toThrow('404');

    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: true, json: async () => ({ url: 'https://r2.example/signed', filename: 'R.mp4', proxied: false }),
    }));
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, statusText: 'Forbidden' }));
    await expect(fetchReelDownload(7)).rejects.toThrow('403');
  });
});
