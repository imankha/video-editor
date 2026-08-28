// Regression: the font manifest + @font-face URLs must be resolved through
// `resolveApiUrl`, never left as bare '/api/...' paths.
//
// The bug this pins (found on staging 2026-08-04, shipped by T5180/T5225):
// a bare '/api/fonts/...' resolves against the FRONTEND origin. In staging and
// prod that is Cloudflare Pages, not the API, and the SPA catch-all answers
// every unknown path with index.html at HTTP 200 / text/html. So the manifest
// fetch returned HTML, no @font-face rule was ever injected, and EVERY font
// fell back to the same default face -- the font picker changed `spec.font`
// and nothing on screen changed.
//
// It passed every existing test and every local run because Vite proxies /api
// to the backend in dev. Only a deployed origin exposes it, which is why this
// asserts the URL SHAPE rather than the rendered pixels.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const API_BASE = 'https://api.example.test';

vi.mock('../config', () => ({
  API_BASE,
  resolveApiUrl: (url) => (url && url.startsWith('/') ? `${API_BASE}${url}` : url),
}));

const MANIFEST = {
  anton: { file: 'Anton-Regular.ttf', weight: 400, style: 'normal', isVariable: false },
  oswald: {
    file: 'Oswald-Variable.ttf',
    weight: 500,
    style: 'normal',
    isVariable: true,
    variationRange: [200, 700],
  },
  // T6500 overlay faces — both static, must resolve through the API origin too.
  inter: { file: 'Inter-Medium.ttf', weight: 500, style: 'normal', isVariable: false },
  archivoblack: { file: 'ArchivoBlack-Regular.ttf', weight: 900, style: 'normal', isVariable: false },
};

const SPEC = {
  text: 'GOAL',
  font: 'anton',
  size: 0.08,
  color: '#FFD66B',
  align: 'center',
  position: { x: 0.5, y: 0.5 },
  maxWidth: 0.8,
  shadow: { blur: 0, color: '#000000', opacity: 0 },
  stroke: { width: 0, color: '#000000' },
  animation: 'none',
};

describe('RichText font URLs are API-base resolved', () => {
  let fetchSpy;

  beforeEach(() => {
    vi.resetModules();
    document.querySelectorAll('style[data-rich-text-font-faces]').forEach((n) => n.remove());
    fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(MANIFEST) })
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the manifest from the API origin, not the frontend origin', async () => {
    const { RichText } = await import('./RichText');
    render(<RichText spec={SPEC} boxWidth={100} boxHeight={100} />);

    // Let the module-level manifest fetch settle.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const requested = String(fetchSpy.mock.calls[0][0]);
    expect(requested).toBe(`${API_BASE}/api/fonts/fonts.json`);
    // The precise failure mode: a bare path that the SPA catch-all would answer.
    expect(requested.startsWith('/api/')).toBe(false);
  });

  it('injects @font-face src URLs pointing at the API origin', async () => {
    const { RichText } = await import('./RichText');
    render(<RichText spec={SPEC} boxWidth={100} boxHeight={100} />);

    await vi.waitFor(() => {
      const styleEl = document.querySelector('style[data-rich-text-font-faces]');
      expect(styleEl).toBeTruthy();
      return styleEl;
    });

    const css = document.querySelector('style[data-rich-text-font-faces]').textContent;
    expect(css).toContain(`url("${API_BASE}/api/fonts/Anton-Regular.ttf")`);
    expect(css).toContain(`url("${API_BASE}/api/fonts/Oswald-Variable.ttf")`);
    // T6500 overlay faces go through the SAME injection loop — pin them too.
    expect(css).toContain(`url("${API_BASE}/api/fonts/Inter-Medium.ttf")`);
    expect(css).toContain(`url("${API_BASE}/api/fonts/ArchivoBlack-Regular.ttf")`);
    // No bare-path src survived.
    expect(css).not.toContain('url("/api/');
  });
});
