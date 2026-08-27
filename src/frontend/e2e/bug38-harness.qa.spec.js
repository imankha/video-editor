/**
 * Bug 38 QA (dev-only harness) — real-browser proof of both glitches when no
 * exported reel exists in the env (Overlay is gated on an exported reel; all of
 * this account's drafts are "Not Started", so a live-account spec honest-skips).
 *
 * Mounts the REAL modules (bug38diag.html / src/bug38diag/main.jsx):
 *   Glitch 2 — real useHighlightRegions.restoreRegions (backend delivers regions
 *     with keyframes:[] + detections) + real HighlightOverlay: the auto/
 *     pre-selected spotlight must land on the MAIN CENTERED player box (400,150),
 *     NOT the geometric frame center (320,180) nor the loud corner bystander (70,60).
 *   Glitch 3 — real useVideo.stepForward against a real <video>: stepping one
 *     frame while paused must actually change the displayed frame's pixels.
 *     (Chromium proves the client step->seek->paint path; the Safari-specific
 *     requestVideoFrameCallback repaint is verified by Vitest useVideo.stepPaint.)
 *
 * The sample MP4 is generated to /tmp and served via page.route (NOT vite's
 * publicDir, which caches at startup so a post-start public file won't serve —
 * the T5676 landmine).
 *
 * Run: cd src/frontend && npx playwright test e2e/bug38-harness.qa.spec.js
 * or:  bash scripts/dev-verify.sh e2e/bug38-harness.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const SAMPLE = '/tmp/bug38diag-sample.mp4';
const HARNESS = '/bug38diag.html';

// From src/bug38diag/main.jsx.
const FRAME_CENTER = { x: 320, y: 180 };
const MAIN_BOX = { x: 400, y: 150 };
const BYSTANDER = { x: 70, y: 60 };

test.beforeAll(() => {
  if (!existsSync(SAMPLE)) {
    // testsrc animates over time so consecutive frames differ (glitch-3 pixel check).
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=3:size=640x360:rate=30 -pix_fmt yuv420p -movflags +faststart "${SAMPLE}"`,
      { stdio: 'ignore' }
    );
  }
});

/** Serve the sample MP4 from /tmp, honoring Range so the <video> can seek. */
async function routeSample(page) {
  const bytes = readFileSync(SAMPLE);
  await page.route('**/bug38diag-sample.mp4', async (route) => {
    const range = route.request().headers()['range'];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : bytes.length - 1;
      const chunk = bytes.subarray(start, end + 1);
      await route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Content-Length': String(chunk.length),
        },
        body: chunk,
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(bytes.length) },
        body: bytes,
      });
    }
  });
}

test.describe('bug38 harness @staging-gate @gate-c', () => {
  // /bug38diag.html is a Vite-dev-only harness page: not an input to the production
  // build, so on a deployed target this RELATIVE path resolves against the Pages origin
  // and the SPA catch-all serves index.html instead — the harness never mounts.
  skipOnDeployedTarget(test, 'drives the dev-only /bug38diag.html harness page, which does not exist in a production BUILD');

  test('glitch 2: auto spotlight lands on the main centered player, not frame center', async ({ page }) => {
    test.setTimeout(60_000);
    await routeSample(page);
    await page.goto(HARNESS);

    const ellipse = page.locator('[data-testid="highlight-body"]').first();
    await ellipse.waitFor({ timeout: 20000 });
    const geom = await ellipse.evaluate((el) => ({
      cx: +el.getAttribute('cx'), cy: +el.getAttribute('cy'),
    }));

    // Container is 640x360 == video metadata (zoom 1, no letterbox), so ellipse
    // cx/cy in screen space equal the video-space coordinates 1:1.
    const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
    const dMain = dist(geom.cx, geom.cy, MAIN_BOX.x, MAIN_BOX.y);
    const dCenter = dist(geom.cx, geom.cy, FRAME_CENTER.x, FRAME_CENTER.y);
    const dBystander = dist(geom.cx, geom.cy, BYSTANDER.x, BYSTANDER.y);

    await saveEvidence(page, 'bug38-glitch2-autoselect-harness');

    expect(dMain, `spotlight (${geom.cx},${geom.cy}) should sit on the main player`).toBeLessThanOrEqual(20);
    expect(dMain).toBeLessThan(dCenter);
    expect(dMain).toBeLessThan(dBystander);
  });

  test('glitch 3: stepping one frame while paused changes the displayed frame', async ({ page }) => {
    test.setTimeout(60_000);
    await routeSample(page);
    await page.goto(HARNESS);

    // Wait for the framestep <video> (last one) to have a decodable frame.
    await page.waitForFunction(() => {
      const vs = document.querySelectorAll('video');
      const v = vs[vs.length - 1];
      return v && v.readyState >= 2 && v.duration > 0.5;
    }, { timeout: 25000 });

    await page.locator('[data-testid="pause"]').click();
    await page.evaluate(() => {
      const vs = document.querySelectorAll('video');
      vs[vs.length - 1].currentTime = 0.5;
    });
    await page.waitForTimeout(800);

    const grab = () => page.evaluate(() => {
      const vs = document.querySelectorAll('video');
      const v = vs[vs.length - 1];
      const c = document.createElement('canvas');
      c.width = 64; c.height = 36;
      const ctx = c.getContext('2d');
      try { ctx.drawImage(v, 0, 0, c.width, c.height); return c.toDataURL('image/png'); }
      catch { return null; }
    });

    const before = await grab();
    expect(before, 'could read video pixels').toBeTruthy();
    await saveEvidence(page, 'bug38-glitch3-before-step');

    // Step forward one frame via the REAL useVideo.stepForward.
    await page.locator('[data-testid="step-fwd"]').click();
    await page.waitForTimeout(1000);

    const after = await grab();
    await saveEvidence(page, 'bug38-glitch3-after-step');

    const paused = await page.evaluate(() => {
      const vs = document.querySelectorAll('video');
      return vs[vs.length - 1].paused;
    });
    expect(paused, 'stays paused during frame step').toBe(true);
    expect(after, 'displayed frame changed after paused step').not.toBe(before);

    await responsiveSweep(page);
  });
});
