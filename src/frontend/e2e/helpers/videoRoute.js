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

/**
 * Real-account (deployed) surface variant of waitForVideoReady — returns a VERDICT
 * instead of hanging (T6110).
 *
 * WHY A SECOND ENTRY POINT (T6110, 2026-07-27). `waitForVideoReady` gates a LOCAL
 * routed fixture (routeSeekableVideo above) that is guaranteed loadable, so a plain
 * throw-on-timeout is correct there. On a REAL staging account the <video> src is the
 * account's working video streamed from R2, and T6100 MEASURED a second failure mode
 * the local fixture can never hit: staging carries DANGLING `working_videos` refs —
 * `working_video/playback-url` returns 200 with a presigned URL, but the R2 GET for
 * that object is a fast, deterministic 404 (~120ms). The <video> then fires `error`
 * and the ready-signal (readyState / the overlay stage's inline `aspect-ratio`) can
 * NEVER arrive. Waiting longer cannot fix that — it is the same bug, slower (that is
 * exactly the 240s-timeout failure T5676 hit picking `.first()` draft blindly).
 *
 * So the three real-account specs must gate on THIS, which resolves three ways FAST:
 *   { ready: true }                  — can seek + play (+ overlay aspect-ratio, if asked);
 *                                      the only state in which a spec may assert geometry.
 *   { ready: false, reason: '...' }  — the element errored (dangling/missing R2 object,
 *                                      names the MediaError code), OR nothing ever hydrated
 *                                      within `timeout` (no ready-signal, no error).
 * The caller then either advances to another draft (choose-a-loadable-draft) or SKIPS
 * LOUDLY naming hydration — never asserts a domain fact against a placeholder, never
 * waits out a signal that can't arrive. A `false` verdict is a hydration verdict, NOT a
 * raised timeout masking a real regression.
 *
 * The video element is scoped to `.video-container video` (the editor player); note
 * OverlayModeView only mounts VideoPlayer once `effectiveOverlayVideoUrl` resolves, so
 * a playback-url 404 (no URL at all) surfaces here as the never-hydrated branch.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {number} [opts.minReadyState=3] required HTMLMediaElement.readyState. 3
 *   (HAVE_FUTURE_DATA) for specs that seek/drag/step; 2 (HAVE_CURRENT_DATA, a decoded
 *   current frame) is enough for a pure geometry/layout check (e.g. T5676 alignment).
 * @param {boolean} [opts.requireAspectRatio=false] also require the overlay stage's
 *   inline `aspect-ratio` style — the app's OWN metadata-ready signal (T5676), which
 *   is what flips `useAspectStage`/`fitToAspect` and kills the pillarbox.
 * @param {number} [opts.timeout=20000] detection bound; a loadable reel reaches ready
 *   in a couple seconds and a dangling one errors in ~1s, so this only caps the
 *   genuinely-never-hydrated case.
 * @returns {Promise<{ready: boolean, reason?: string}>}
 */
export async function waitForRealVideoReady(page, opts = {}) {
  const { minReadyState = 3, requireAspectRatio = false, timeout = 20000 } = opts;
  try {
    const handle = await page.waitForFunction(
      ({ minRS, needAspect }) => {
        const v = document.querySelector('.video-container video');
        if (v && v.error) {
          return {
            ready: false,
            reason:
              `<video> error (MediaError code ${v.error.code}${v.error.message ? `: ${v.error.message}` : ''}) — ` +
              'the working video did not stream. On staging this is a DANGLING working_video ref ' +
              '(playback-url 200 but the R2 object GET 404s, per T6100). The video never hydrated.',
          };
        }
        if (!v) return false; // VideoPlayer not mounted yet (URL unresolved) — keep waiting
        const seekablePlayable =
          v.readyState >= minRS &&
          Number.isFinite(v.duration) &&
          (minRS < 3 || v.seekable.length > 0);
        if (!seekablePlayable) return false;
        if (needAspect) {
          const stage = document.querySelector('[data-testid="overlay-video-stage"]');
          if (!(stage && stage.style && stage.style.aspectRatio && v.videoWidth > 0)) return false;
        }
        return { ready: true };
      },
      { minRS: minReadyState, needAspect: requireAspectRatio },
      { timeout, polling: 100 },
    );
    return handle.jsonValue();
  } catch (e) {
    if (e.name === 'TimeoutError' || /Timeout.*exceeded/i.test(e.message || '')) {
      return {
        ready: false,
        reason:
          `the video never hydrated within ${timeout}ms (no ready-signal, no <video> error). ` +
          'The working video did not stream — a missing/unresolved playback-url or a stalled R2 ' +
          'object (dangling working_video ref, per T6100), NOT an inaccurate measurement.',
      };
    }
    throw e;
  }
}
