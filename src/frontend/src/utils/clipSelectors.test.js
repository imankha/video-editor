import { describe, it, expect, vi } from 'vitest';

/**
 * T5890 regression for the clip-file URL. The proxy fallback (used when a clip has
 * no presigned R2 `file_url`) must carry API_BASE, so the <video src> points at the
 * backend host and not a bare `/api/...` that resolves against the Cloudflare Pages
 * origin on split-host staging/prod. A non-empty base is forced so a bare path is
 * distinguishable from the fix (see GameTile.posterUrl.test.jsx for the rationale).
 */
const { API_HOST } = vi.hoisted(() => ({ API_HOST: 'https://reel-ballers-api-staging.fly.dev' }));

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal()),
  API_BASE: API_HOST,
}));

import { clipFileUrl } from './clipSelectors';

describe('clipFileUrl (T5890 split-host)', () => {
  it('prefers a presigned absolute file_url unchanged', () => {
    const clip = { id: 7, file_url: 'https://r2.example.com/clips/7.mp4?sig=abc' };
    expect(clipFileUrl(clip, 99)).toBe('https://r2.example.com/clips/7.mp4?sig=abc');
  });

  it('falls back to the backend proxy URL WITH API_BASE, not a bare /api path', () => {
    const clip = { id: 7, file_url: null };
    const url = clipFileUrl(clip, 99);
    expect(url).toBe(`${API_HOST}/api/clips/projects/99/clips/7/file`);
    expect(url.startsWith(API_HOST)).toBe(true);
    expect(url.startsWith('/api/')).toBe(false);
  });
});
