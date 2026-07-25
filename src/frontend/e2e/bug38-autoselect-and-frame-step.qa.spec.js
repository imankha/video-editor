/**
 * Bug 38 QA — auto-select the main centered player (glitch 2) + frame-by-frame
 * stepping while paused actually shows the stepped frame (glitch 3).
 *
 * Drives the REAL app as a real user (dev-login) into Overlay mode.
 *
 * Glitch 2: with player detections rendered, the auto/pre-selected spotlight
 *   ellipse must sit on the MAIN CENTERED player's box, not the geometric frame
 *   center. Honest-skips if this env has no detection boxes (Modal/GPU off) —
 *   without detections the centered default is the correct degradation, so the
 *   discriminating assertion can only run when boxes exist; unit tests cover the
 *   heuristic regardless.
 * Glitch 3: pause, snapshot the <video> pixels, step one frame while paused,
 *   snapshot again, and assert the displayed frame CHANGED. (Chromium, not
 *   WebKit — this proves the client step→seek→paint path advances and renders
 *   while paused; the Safari-specific requestVideoFrameCallback repaint is the
 *   scoped mitigation, verified by Vitest useVideo.stepPaint.test.js.)
 *
 * Run: cd src/frontend && npx playwright test e2e/bug38-autoselect-and-frame-step.qa.spec.js
 * or:  bash scripts/dev-verify.sh e2e/bug38-autoselect-and-frame-step.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

function captureConsole(page) {
  const lines = [];
  page.on('console', (m) => lines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  return lines;
}

/** Open the first Framing-ready reel draft, then switch to Overlay (if exported). */
async function openOverlay(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  const framingChip = page.getByTitle(/\[.+\]: .*\(click to open\)/).first();
  await framingChip.waitFor({ timeout: 30000 });
  await framingChip.click();
  await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });

  const overlayTab = page.getByTestId('mode-overlay');
  const reachable = (await overlayTab.count()) > 0 && (await overlayTab.isEnabled());
  test.skip(!reachable, 'Overlay needs an exported reel in this env; covered by Vitest');
  await overlayTab.click();

  // Ensure a spotlight region exists so HighlightOverlay renders.
  const addSpotlight = page.getByRole('button', { name: /Add Spotlight/ });
  if (await addSpotlight.count()) {
    await addSpotlight.first().click().catch(() => {});
  }
}

test.describe('bug38 auto-select + frame-step @staging-gate', () => {
  test('glitch 2: auto spotlight lands on the main centered player (when detections render)', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    captureConsole(page);

    await openOverlay(page);

    const ellipse = page.locator('svg ellipse.cursor-move').first();
    await ellipse.waitFor({ timeout: 30000 });
    const geom = await ellipse.evaluate((el) => ({
      cx: +el.getAttribute('cx'), cy: +el.getAttribute('cy'),
    }));
    expect(Number.isFinite(geom.cx) && Number.isFinite(geom.cy)).toBe(true);
    await saveEvidence(page, 'bug38-glitch2-spotlight-placed');

    // Detection boxes (screen space) — dashed rects from PlayerDetectionOverlay.
    const detBoxes = page.locator('svg rect[stroke-dasharray]');
    const boxCount = await detBoxes.count();
    test.skip(boxCount === 0,
      'No detection boxes in this env (Modal/GPU off) — centered default is correct without detections; heuristic covered by Vitest');

    // Video display rect center == the frame center in screen space.
    const container = page.locator('.video-container').first();
    const cbox = await container.boundingBox();
    const frameCenter = { x: cbox.x + cbox.width / 2, y: cbox.y + cbox.height / 2 };

    // Collect box centers (screen space).
    const centers = [];
    for (let i = 0; i < boxCount; i++) {
      const r = await detBoxes.nth(i).evaluate((el) => ({
        x: +el.getAttribute('x'), y: +el.getAttribute('y'),
        w: +el.getAttribute('width'), h: +el.getAttribute('height'),
      }));
      const parent = await container.boundingBox();
      centers.push({ x: parent.x + r.x + r.w / 2, y: parent.y + r.y + r.h / 2, w: r.w, h: r.h });
    }
    // The box nearest the frame center is the expected "main centered player".
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const nearest = centers.reduce((best, c) =>
      dist(c, frameCenter) < dist(best, frameCenter) ? c : best, centers[0]);

    // Ellipse center in screen space (ellipse is inside the same container).
    const cparent = await container.boundingBox();
    const ellScreen = { x: cparent.x + geom.cx, y: cparent.y + geom.cy };

    // The spotlight must be closer to the main centered player's box than the
    // ellipse's radius suggests — assert it sits on that box, within a tolerance
    // of half the box size (the ×1.3 padded ellipse is centered on the box).
    const tol = Math.max(nearest.w, nearest.h) * 0.75 + 8;
    expect(dist(ellScreen, nearest),
      `spotlight center should sit on the main centered player's box`).toBeLessThanOrEqual(tol);
    await saveEvidence(page, 'bug38-glitch2-spotlight-on-centered-player');

    await context.close();
  });

  test('glitch 3: stepping one frame while paused changes the displayed frame', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    captureConsole(page);

    await openOverlay(page);

    const video = page.locator('video').first();
    await video.waitFor({ timeout: 30000 });

    // Ensure paused and give the source a moment to buffer a frame.
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      v.pause();
      // seek a little in so we're on a decodable, non-zero frame
      if (v.readyState >= 1 && v.duration > 0.5) v.currentTime = Math.min(0.5, v.duration / 2);
    });
    await page.waitForTimeout(800);

    // Snapshot the currently displayed video frame's pixels.
    const grab = async () => page.evaluate(() => {
      const v = document.querySelector('video');
      const c = document.createElement('canvas');
      c.width = 64; c.height = 36;
      const ctx = c.getContext('2d');
      try { ctx.drawImage(v, 0, 0, c.width, c.height); } catch { return null; }
      return c.toDataURL('image/png');
    });

    const before = await grab();
    test.skip(!before, 'Could not read video pixels in this env (CORS/taint) — client step path covered by Vitest');
    await saveEvidence(page, 'bug38-glitch3-before-step');

    // Step forward one frame while paused (on-screen control; falls back to key).
    const stepFwd = page.getByTitle('Step forward (one frame)');
    if (await stepFwd.count()) {
      await stepFwd.first().click();
    } else {
      await page.locator('body').press('ArrowRight');
    }
    // Give the paused seek + rVFC repaint time to present the new frame.
    await page.waitForTimeout(1200);

    const after = await grab();
    await saveEvidence(page, 'bug38-glitch3-after-step');

    // Still paused, and the displayed frame actually changed.
    const paused = await page.evaluate(() => document.querySelector('video').paused);
    expect(paused, 'video stays paused during frame step').toBe(true);
    expect(after, 'stepped frame rendered while paused (pixels changed)').not.toBe(before);

    // Responsive evidence sweep.
    await responsiveSweep(page);

    await context.close();
  });
});
