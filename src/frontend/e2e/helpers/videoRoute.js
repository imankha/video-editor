import { readFileSync } from 'node:fs';

/**
 * Serve a local media file to the browser through Playwright's request interception,
 * with HTTP Range support, and then WAIT ON A REAL READINESS SIGNAL before returning.
 *
 * WHY THIS EXISTS (T6060). The overlay dev-harness specs point a real <video> at a
 * relative URL (e.g. /overlaydiag-sample.mp4) whose file is ffmpeg-generated in
 * `beforeAll`. Two independent failure modes made the playback-driving specs flake:
 *
 *   1. Vite v5 dev caches its publicDir listing AT STARTUP, so a file created after the
 *      dev server is up 404s — vite then serves the SPA index.html for the <video> src,
 *      the media fails to load, play() rejects (swallowed by `.catch`), and every
 *      "video plays" wait times out. (Same landmine the T5676 aspectdiag spec fixed.)
 *   2. Even once the bytes are served, a plain `route.fulfill({ body })` answers with a
 *      single 200 and NO `Accept-Ranges`, so Chromium marks the element non-seekable
 *      (`video.seekable == [0,0]`). A seek to the spotlight span start (0.4s) is then
 *      silently dropped and playback runs from 0 — the "seek lands unpredictably" flake.
 *
 * Serving the file from disk with a proper 206 Range response fixes BOTH: it is
 * timing-independent (does not depend on when vite indexed publicDir) AND seekable.
 *
 * The readiness wait asserts on `readyState >= HAVE_FUTURE_DATA` (the media can seek and
 * play) — never a fixed `waitForTimeout`, never element visibility. Only after this does
 * a caller drive playback, so the seek lands and play() cannot reject on an unloaded src.
 *
 * @param {import('@playwright/test').Page} page
 * @param {RegExp} urlPattern  matches the <video> src request (include an optional query)
 * @param {string} filePath    absolute path to the media file on disk
 */
export async function routeSeekableVideo(page, urlPattern, filePath) {
  const buf = readFileSync(filePath);
  await page.route(urlPattern, (route) => {
    const range = route.request().headers().range;
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : buf.length - 1;
      return route.fulfill({
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${buf.length}`,
          'Content-Length': String(end - start + 1),
          'Content-Type': 'video/mp4',
        },
        body: buf.subarray(start, end + 1),
      });
    }
    return route.fulfill({
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(buf.length),
        'Content-Type': 'video/mp4',
      },
      body: buf,
    });
  });
}

/**
 * Wait until the harness <video> has decoded enough to seek + play deterministically.
 * HAVE_FUTURE_DATA (3) guarantees a current frame plus enough buffered data that play()
 * advances and a seek resolves — the real ready-signal to gate playback on.
 */
export async function waitForVideoReady(page, timeout = 15000) {
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.readyState >= 3 && Number.isFinite(v.duration) && v.seekable.length > 0;
  }, null, { timeout });
}
