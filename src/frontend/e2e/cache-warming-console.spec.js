/**
 * T1350: Cache Warming CORS Cleanup
 *
 * Verifies that `cacheWarming.js` does not produce "blocked by CORS policy"
 * console errors. The fix evolved past the original `no-cors` approach: because
 * no-cors strips the Range header (forcing the browser to download the ENTIRE
 * file and hand back an unusable opaque response), `warmUrl()` now SKIPS
 * cross-origin URLs entirely. The <video> element issues its own Range requests
 * for R2 content. Only SAME-ORIGIN proxy/stream URLs are warmed (with the
 * session cookie via `credentials: 'include'`), which never trip CORS.
 *
 * Strategy (light harness, mirrors T1360 pattern):
 *   Run against the vite dev server, dynamically import `cacheWarming.js`, and
 *   monkey-patch `window.fetch` to record each RequestInit. We feed warmUrl a
 *   mix of same-origin and cross-origin URLs and assert:
 *     - cross-origin R2 URLs fire NO fetch (skipped — no CORS error possible).
 *     - same-origin URLs fire a fetch and never use `mode: 'cors'`.
 *     - zero "blocked by CORS policy" messages reach the console.
 *
 * Requires: vite dev server on :5173
 */

import { test, expect } from '@playwright/test';

const DEV_BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const CACHE_WARMING_URL = `${DEV_BASE}/src/utils/cacheWarming.js`;

test.describe('T1350 cache warming CORS cleanup', () => {
  test('warmUrl skips cross-origin URLs and produces no CORS console errors', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      consoleMessages.push({ type: 'pageerror', text: err.message });
    });

    await page.goto(DEV_BASE);

    const result = await page.evaluate(async (modUrl) => {
      const mod = await import(modUrl);

      // Capture fetch invocations. If any same-origin warm fetch were ever
      // issued with `mode: 'cors'` against a resource lacking CORS headers,
      // the browser would log a CORS error — so we also simulate that to prove
      // the code never takes that path.
      const fetchCalls = [];
      // eslint-disable-next-line no-undef
      window.fetch = async (url, init = {}) => {
        fetchCalls.push({ url, mode: init.mode, credentials: init.credentials });
        if (init.mode === 'cors') {
          // eslint-disable-next-line no-undef
          console.error(
            `Access to fetch at '${url}' from origin '${location.origin}' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.`
          );
          throw new TypeError('Failed to fetch');
        }
        // Return a minimal response object the warmer can read.
        return {
          ok: true,
          status: 206,
          type: 'basic',
          // eslint-disable-next-line no-undef
          headers: new Headers(),
        };
      };

      // Mix of cross-origin R2 URLs (must be SKIPPED) and same-origin proxy
      // URLs (must be WARMED). Force bypasses the already-warmed cache.
      const crossOriginUrls = [
        'https://example.r2.cloudflarestorage.com/video1.mp4?sig=a',
        'https://example.r2.cloudflarestorage.com/video2.mp4?sig=b',
      ];
      const sameOriginUrls = [
        '/api/stream/video1.mp4',
        '/api/stream/video2.mp4',
      ];

      const crossWarmed = await mod.warmMultipleVideos(crossOriginUrls, { concurrency: 2, force: true });
      const sameWarmed = await mod.warmMultipleVideos(sameOriginUrls, { concurrency: 2, force: true });

      return {
        crossWarmed,
        sameWarmed,
        fetchCalls,
      };
    }, CACHE_WARMING_URL);

    // Cross-origin URLs are skipped: no fetch, no warm reported.
    expect(result.crossWarmed).toBe(0);
    const crossFetches = result.fetchCalls.filter((c) =>
      c.url.startsWith('https://example.r2.cloudflarestorage.com')
    );
    expect(crossFetches.length).toBe(0);

    // Same-origin URLs are warmed: one fetch each, never `mode: 'cors'`,
    // and they carry the session cookie via `credentials: 'include'`.
    const sameFetches = result.fetchCalls.filter((c) => c.url.startsWith('/api/stream/'));
    expect(sameFetches.length).toBeGreaterThanOrEqual(2);
    for (const call of sameFetches) {
      expect(call.mode).not.toBe('cors');
      expect(call.credentials).toBe('include');
    }
    expect(result.sameWarmed).toBe(2);

    // The core assertion: zero CORS-blocked errors in console.
    const corsErrors = consoleMessages.filter((m) =>
      /blocked by CORS policy/i.test(m.text)
    );
    expect(corsErrors).toEqual([]);
  });
});
