/**
 * T1350: Cache Warming CORS Cleanup
 *
 * Verifies that `cacheWarming.js` does not produce "blocked by CORS policy"
 * console errors. The root cause is `warmUrl()` using `mode: 'cors'` against
 * R2 presigned URLs that lack CORS headers — switching to `mode: 'no-cors'`
 * still warms the edge cache but avoids the console spam.
 *
 * Strategy (light harness, mirrors T1360 pattern):
 *   Run against vite dev server, dynamically import `cacheWarming.js`, and
 *   monkey-patch `window.fetch` to (a) record the RequestInit passed to
 *   fetch and (b) simulate the browser's CORS rejection (same TypeError the
 *   browser throws when CORS headers are missing, plus emitting a console
 *   error matching the real browser message).
 *
 * Assertions:
 *   - No console message matches /blocked by CORS policy/ after warmup.
 *   - fetch was invoked with `mode: 'no-cors'` (the actual fix).
 *
 * Requires: vite dev server on :5173
 */

import { test, expect } from '@playwright/test';

const DEV_BASE = 'http://localhost:5173';
const CACHE_WARMING_URL = `${DEV_BASE}/src/utils/cacheWarming.js`;

test.describe('T1350 cache warming CORS cleanup', () => {
  test('warmUrl uses no-cors mode and produces no CORS console errors', async ({ page }) => {
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

      // Capture fetch invocations and simulate a real browser's CORS
      // rejection: when `mode: 'cors'` is used against a URL with no
      // Access-Control-Allow-Origin, the browser logs a CORS error to the
      // console AND rejects the fetch with a TypeError. With `mode: 'no-cors'`,
      // the browser returns an opaque response (status 0, ok=false) and
      // logs nothing.
      const fetchCalls = [];
      // eslint-disable-next-line no-undef
      window.fetch = async (url, init = {}) => {
        fetchCalls.push({ url, mode: init.mode, headers: init.headers });
        if (init.mode === 'cors') {
          // Emit the exact error shape the browser uses.
          console.error(
            `Access to fetch at '${url}' from origin '${location.origin}' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.`
          );
          throw new TypeError('Failed to fetch');
        }
        // no-cors path: return an opaque-ish response. status 0 / ok false.
        return {
          ok: false,
          status: 0,
          type: 'opaque',
          headers: new Headers(),
        };
      };

      // Drive warmMultipleVideos (exercises warmUrl) against 3 fake presigned URLs.
      const urls = [
        'https://example.r2.cloudflarestorage.com/video1.mp4?sig=a',
        'https://example.r2.cloudflarestorage.com/video2.mp4?sig=b',
        'https://example.r2.cloudflarestorage.com/video3.mp4?sig=c',
      ];
      const warmed = await mod.warmMultipleVideos(urls, { concurrency: 3, force: true });

      return {
        warmed,
        fetchCalls,
      };
    }, CACHE_WARMING_URL);

    // Sanity: warming still fires against every URL.
    expect(result.fetchCalls.length).toBeGreaterThanOrEqual(3);
    // All fetches use no-cors (the fix).
    for (const call of result.fetchCalls) {
      expect(call.mode).toBe('no-cors');
    }
    // Warming reports success for every URL (opaque response counts as warmed).
    expect(result.warmed).toBe(3);

    // The core assertion: zero CORS-blocked errors in console.
    const corsErrors = consoleMessages.filter((m) =>
      /blocked by CORS policy/i.test(m.text)
    );
    expect(corsErrors).toEqual([]);
  });
});
