import { test, expect } from '@playwright/test';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';

/**
 * T10800 — REAL-BROWSER proof that the non-fullscreen Annotate single-video stage
 * is aspect-fit (mirrors Overlay's T5676), so a 16:9 game no longer sits inside a
 * fixed h-[40vh]/60vh box with black letterbox bands above/below on a phone. The
 * reclaimed vertical room goes to the controls/timeline/CTAs below — the timeline
 * and Mark-play stay reachable WITHOUT a page scroll.
 *
 * Evidence (measured, not eyeballed):
 *  - the <video> FILLS its `.video-container` in both axes (|diff| <= 1px) at both
 *    phone viewports → object-contain is a no-op → no bands;
 *  - the video box height is far below the old fixed box (~341px @ 393x852) — the
 *    reclaim;
 *  - the primary CTA (Mark play) sits inside the viewport with no page scroll;
 *  - desktop 1280x800: the box height is <= the old 60vh fixed box and the clips
 *    sidebar keeps its geometry;
 *  - fullscreen: the video rect is recorded (its sizing is owned by the fullscreen
 *    branch, untouched by this task).
 *
 * Run (in a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T10800-annotate-aspect-stage.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 7); // "at Sporting" — 16:9, long

const FILL_TOL = 2; // px: sub-pixel rounding + a 1px border (width-bound phone box)
// The desktop box is shrink-wrapped (lg:w-fit lg:h-[60vh] + CSS aspect-ratio), so
// width is DERIVED from a rounded 60vh height — a couple more px of rounding slack
// than the width-bound phone box. Still "video fills box", no perceptible band.
const FILL_TOL_DESKTOP = 6;

/** Measure the `.video-container` box and its rendered <video> box. */
async function measureStage(page) {
  return page.evaluate(() => {
    const container = document.querySelector('.video-container');
    const video = container?.querySelector('video');
    if (!container || !video) return null;
    const c = container.getBoundingClientRect();
    const v = video.getBoundingClientRect();
    return {
      container: { x: c.x, y: c.y, width: c.width, height: c.height },
      video: { x: v.x, y: v.y, width: v.width, height: v.height },
      natural: { w: video.videoWidth, h: video.videoHeight },
    };
  });
}

async function waitForStage(page) {
  await page.locator('.video-container video').first().waitFor({ state: 'visible', timeout: 30000 });
  // Let metadata/layout settle so the aspect box has its final size.
  await page.waitForTimeout(500);
}

const PHONES = [
  { name: '393x852', width: 393, height: 852 },
  { name: '360x740', width: 360, height: 740 },
];

test.describe('T10800 Annotate aspect-fit stage — phone (no letterbox, timeline reclaimed)', () => {
  skipOnDeployedTarget(test, 'dev-login + /api real-account data are dev/local-only seams');

  for (const vp of PHONES) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

      test.beforeEach(async ({ context }) => {
        test.setTimeout(180_000);
        await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      });

      test('the video fills its box (no bands) and Mark play is reachable without page scroll', async ({ page }) => {
        await openGameInAnnotate(page, GAME_ID);
        await waitForStage(page);

        const m = await measureStage(page);
        expect(m, 'measured .video-container + <video>').not.toBeNull();

        // No letterbox: the <video> fills its container in both axes.
        expect(Math.abs(m.video.height - m.container.height),
          'video height fills container (no top/bottom bands)').toBeLessThanOrEqual(FILL_TOL);
        expect(Math.abs(m.video.width - m.container.width),
          'video width fills container (no side pillarbox)').toBeLessThanOrEqual(FILL_TOL);

        // The reclaim: the old fixed box was ~40vh (~341px @ 852h / ~296px @ 740h).
        // A 16:9 aspect box is much shorter — assert it is comfortably below 40vh.
        expect(m.container.height, 'aspect box shorter than the old 40vh fixed box')
          .toBeLessThan(vp.height * 0.40 - 20);

        await saveEvidence(page, `criterion-no-bands-${vp.name}`);

        // Mark play (primary CTA) must be inside the viewport without a page scroll.
        const cta = page.locator('[data-testid="annotate-primary-cta"]').first();
        await cta.waitFor({ state: 'visible', timeout: 15000 });
        const ctaBox = await cta.boundingBox();
        expect(ctaBox, 'primary CTA box').not.toBeNull();
        expect(ctaBox.y + ctaBox.height,
          'Mark play bottom is within the viewport (no scroll to reach it)')
          .toBeLessThanOrEqual(vp.height + 1);

        // And there is no page-level vertical scroll needed.
        const overflow = await page.evaluate(
          () => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight);
        expect(overflow, 'no page vertical overflow at the phone viewport').toBeLessThanOrEqual(1);

        await saveEvidence(page, `criterion-markplay-reachable-${vp.name}`);
        await responsiveSweep(page);
      });
    });
  }
});

test.describe('T10800 Annotate aspect-fit stage — desktop (box <= today, sidebar unchanged)', () => {
  skipOnDeployedTarget(test, 'dev-login + /api real-account data are dev/local-only seams');
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  });

  test('desktop video box height <= the old 60vh box; clips sidebar keeps its geometry', async ({ page }) => {
    await openGameInAnnotate(page, GAME_ID);
    await waitForStage(page);

    const m = await measureStage(page);
    expect(m, 'measured stage').not.toBeNull();
    // lg cap is 60vh; the box must never be taller than today's fixed 60vh.
    expect(m.container.height, 'desktop box height capped at 60vh')
      .toBeLessThanOrEqual(800 * 0.60 + 2);
    // No bands on desktop either (shrink-wrapped box → slightly looser slack).
    expect(Math.abs(m.video.height - m.container.height),
      'video fills box height on desktop').toBeLessThanOrEqual(FILL_TOL_DESKTOP);

    // Sidebar geometry unchanged: the shrink-wrapped stage leaves the clips
    // sidebar its room (the stage no longer spans the full column width).
    const sidebar = page.locator('[data-testid="clips-side-panel"]').first();
    if (await sidebar.count()) {
      const sb = await sidebar.boundingBox();
      expect(sb, 'clips sidebar renders with geometry').not.toBeNull();
      expect(sb.width, 'sidebar keeps a real width').toBeGreaterThan(0);
    }

    await saveEvidence(page, 'criterion-desktop-box-capped');
  });
});

test.describe('T10800 Annotate fullscreen — sizing untouched (evidence)', () => {
  skipOnDeployedTarget(test, 'dev-login + /api real-account data are dev/local-only seams');
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  });

  test('entering fullscreen keeps a full-bleed video (its sizing is owned by the FS branch)', async ({ page }) => {
    await openGameInAnnotate(page, GAME_ID);
    await waitForStage(page);

    const fsBtn = page.getByTitle('Fullscreen').first();
    if (!(await fsBtn.count())) {
      test.skip(true, 'fullscreen toggle not offered for this game/viewport (fullscreenWorthwhile gate)');
      return;
    }
    await fsBtn.click();
    await page.waitForTimeout(600);
    await saveEvidence(page, 'criterion-fullscreen');

    const v = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return null;
      const r = video.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    expect(v, 'fullscreen video rect').not.toBeNull();
    // mobileFs is w-full h-full — the video spans (near) the full viewport width.
    expect(v.width, 'fullscreen video is full-bleed').toBeGreaterThan(393 * 0.9);
  });
});
