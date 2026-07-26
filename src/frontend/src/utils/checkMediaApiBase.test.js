/* eslint-disable no-template-curly-in-string --
   The strings below deliberately contain literal `${...}` sequences: they are
   sample SOURCE lines fed to the guard's scanner, not runtime template literals. */
import { describe, it, expect } from 'vitest';
// The regression guard added for T5890 (repo-root scripts/). Pin its scan logic so
// the gate itself cannot silently stop catching the bug class it exists to block.
import { scanText } from '../../../../scripts/check-media-api-base.mjs';

describe('check-media-api-base guard (T5890)', () => {
  it('flags a bare /api/ poster src (the original bug)', () => {
    const hits = scanText('const posterUrl = `/api/games/${game.id}/poster.jpg`;');
    expect(hits.length).toBe(1);
    expect(hits[0].line).toBe(1);
  });

  it('flags a bare /api/ clip-file src', () => {
    const hits = scanText('return `/api/clips/projects/${p}/clips/${c}/file`;');
    expect(hits.length).toBe(1);
  });

  it('flags a bare /api/ hyphenated media endpoint (working-video)', () => {
    // The `-video` (not `/video`) endpoint the backend actually serves; must not slip.
    expect(scanText('const src = `/api/projects/${id}/working-video`;').length).toBe(1);
    expect(scanText('const src = `/api/games/${id}/image`;').length).toBe(1);
  });

  it('passes the API_BASE-prefixed form (the fix)', () => {
    expect(scanText('const p = `${API_BASE}/api/games/${id}/poster.jpg`;')).toEqual([]);
    expect(scanText('return `${API_BASE}/api/clips/projects/${p}/clips/${c}/file`;')).toEqual([]);
  });

  it('ignores bare /api/ paths that are not media (e.g. a fetch endpoint)', () => {
    expect(scanText("fetch('/api/auth/pwa-installed', { method: 'POST' });")).toEqual([]);
    expect(scanText("apiFetch('/api/me/invite-code');")).toEqual([]);
  });

  it('ignores media /api/ paths inside comments', () => {
    expect(scanText('// seeds the early `/api/games/{id}/video` src on first render')).toEqual([]);
    expect(scanText('/** returns paths like `/api/projects/1/working_video/stream` */')).toEqual([]);
  });

  it('respects an inline media-api-base-ok exemption marker', () => {
    expect(scanText('const p = `/api/games/1/poster.jpg`; // media-api-base-ok:test')).toEqual([]);
  });
});
