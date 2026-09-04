import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('./apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

import { resolveWorkingVideoPreviewUrl } from './resolveWorkingVideoPreviewUrl';

describe('resolveWorkingVideoPreviewUrl (T8390)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('resolves the presigned URL on a 200 response', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://r2.example/working.mp4' }) });
    const url = await resolveWorkingVideoPreviewUrl(42);
    expect(url).toBe('https://r2.example/working.mp4');
    expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/projects/42/working_video/playback-url'));
  });

  it('returns null (never throws) on a non-ok response', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    const url = await resolveWorkingVideoPreviewUrl(42);
    expect(url).toBeNull();
  });

  it('returns null (never throws) when the response body has no url', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const url = await resolveWorkingVideoPreviewUrl(42);
    expect(url).toBeNull();
  });

  it('returns null (never throws) on a network error', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('network down'));
    const url = await resolveWorkingVideoPreviewUrl(42);
    expect(url).toBeNull();
  });
});
