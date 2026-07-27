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
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

function captureConsole(page) {
  const lines = [];
  page.on('console', (m) => lines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  return lines;
}

/**
 * Open a reel draft that has reached Overlay AND whose working video actually STREAMS,
 * then gate on the real overlay ready-signal (T6110). Skips loudly (naming hydration)
 * when no streamable draft exists — never acts on a not-yet-hydrated placeholder.
 *
 * Replaces the old framing-chip -> overlay-tab -> "Add Spotlight" path, which had two
 * defects on staging: it could land on a draft whose working_video ref is dangling
 * (playback-url 200 but the R2 GET 404s, per T6100) so the overlay never hydrated and
 * the next `.click()` timed out (the observed 8s `[PERF] leg-err:overlay` failure); and
 * "Add Spotlight" is the overlay EXPORT button — clicking it fires a real, costly render
 * on the real account. A streamable In-Overlay draft already carries restored highlight
 * regions, so the spotlight renders from existing data with no export. minReadyState 3:
 * glitch 3 pauses and STEPS a frame, which needs a seekable, decoded source.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
function openOverlay(page) {
  return openLoadableOverlayDraft(page, { minReadyState: 3 });
}

test.describe('bug38 auto-select + frame-step @staging-gate', () => {
  test('glitch 2: auto spotlight lands on the main centered player (when detections render)', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    captureConsole(page);

    const opened = await openOverlay(page);
    test.skip(!opened.ok, opened.reason);

    // On a real tracking-ON draft `editable` is false, so the draggable body ellipse has
    // NO `.cursor-move` class (the T5676 lesson) — use the always-rendered spotlight MASK
    // ellipse for the auto-select center. Its cx/cy are in the overlay SVG space, which
    // shares the `.video-container` origin (both overlay SVGs are absolute inset-0).
    const ellipse = page.locator('svg defs mask ellipse').first();
    await ellipse.waitFor({ state: 'attached', timeout: 30000 });
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

    // The discriminating check: the auto/pre-selected spotlight must be ANCHORED TO A
    // REAL DETECTED PLAYER (the bug38 fix), not to the fabricated geometric frame center
    // (the old `calculateDefaultHighlight` default). Assert the spotlight center lies
    // INSIDE one of the detection boxes (small padding for the feet-anchor: the auto pick
    // anchors the ellipse at the box's center-x and its lower edge, per
    // highlightFromDetectionBox). The frame center provably lies inside NO box on this
    // real draft, so containment discriminates the fix from the regression.
    //
    // NOTE (why not "the box nearest the frame center"): the real heuristic is
    // `pickPrimaryDetectionBox` — main CENTERED *and prominent* — so on real footage with
    // several players it legitimately picks a prominent near-center player that is not the
    // single geometrically-most-centered box. Replicating that ranking in-spec would need
    // the app util (unavailable on a deployed BUILD); it is deterministically pinned by
    // Vitest useHighlightRegions.autoselect.test.js. Here we assert the property that
    // actually distinguishes fixed-from-broken on real data: anchored to a detected player.
    const container = page.locator('.video-container').first();
    const cbox = await container.boundingBox();
    const frameCenter = { x: cbox.x + cbox.width / 2, y: cbox.y + cbox.height / 2 };

    // Collect box rects (screen space) via the container origin (both overlay SVGs are
    // absolute inset-0 over the video, so the container box is their shared origin).
    const boxes = [];
    for (let i = 0; i < boxCount; i++) {
      const r = await detBoxes.nth(i).evaluate((el) => ({
        x: +el.getAttribute('x'), y: +el.getAttribute('y'),
        w: +el.getAttribute('width'), h: +el.getAttribute('height'),
      }));
      boxes.push({ x: cbox.x + r.x, y: cbox.y + r.y, w: r.w, h: r.h });
    }

    // Spotlight center in screen space (mask ellipse shares the same container origin).
    const ellScreen = { x: cbox.x + geom.cx, y: cbox.y + geom.cy };

    const PAD = 12; // px slack for the feet-anchor + sub-pixel rounding
    const inside = (b) =>
      ellScreen.x >= b.x - PAD && ellScreen.x <= b.x + b.w + PAD &&
      ellScreen.y >= b.y - PAD && ellScreen.y <= b.y + b.h + PAD;
    const anchorBox = boxes.findIndex(inside);
    const frameCenterInAnyBox = boxes.some((b) =>
      frameCenter.x >= b.x && frameCenter.x <= b.x + b.w &&
      frameCenter.y >= b.y && frameCenter.y <= b.y + b.h);
    console.log(`[bug38] spotlight=(${Math.round(ellScreen.x)},${Math.round(ellScreen.y)}) ` +
      `anchoredToBox#${anchorBox} of ${boxCount}; frameCenter=(${Math.round(frameCenter.x)},` +
      `${Math.round(frameCenter.y)}) inAnyBox=${frameCenterInAnyBox}`);

    expect(anchorBox,
      'auto-selected spotlight must anchor to a REAL detected player box (bug38 fix), not the ' +
      'fabricated geometric frame center — the spotlight center lies inside no detection box').toBeGreaterThanOrEqual(0);
    await saveEvidence(page, 'bug38-glitch2-spotlight-on-centered-player');

    await context.close();
  });

  test('glitch 3: stepping one frame while paused changes the displayed frame', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    captureConsole(page);

    const opened = await openOverlay(page);
    test.skip(!opened.ok, opened.reason);

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

    // Snapshot the currently displayed video frame's pixels. On staging the <video>
    // src is a cross-origin presigned R2 URL with no CORS headers, so drawImage TAINTS
    // the canvas and `toDataURL` throws SecurityError — the taint guard must wrap BOTH
    // drawImage AND toDataURL (the old guard wrapped only drawImage, so the throw
    // escaped and failed the test instead of triggering the honest skip below).
    const grab = async () => page.evaluate(() => {
      const v = document.querySelector('video');
      const c = document.createElement('canvas');
      c.width = 64; c.height = 36;
      const ctx = c.getContext('2d');
      try {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      } catch {
        return null; // tainted (cross-origin, no CORS) — cannot read pixels here
      }
    });

    const before = await grab();
    test.skip(!before,
      'Could not read video pixels in this env — the staging <video> is a cross-origin R2 URL ' +
      'without CORS, so the canvas is tainted; the client step->seek->paint path is covered by ' +
      'Vitest useVideo.stepPaint.test.js and the bug38diag harness spec.');
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
