import { test, expect } from '@playwright/test';
import { loginAsDevPreset } from './helpers/realAuth.js';

/**
 * T14850 — Frame and Spotlight on short desktop viewports.
 *
 * Below ~850px of viewport height at desktop widths, the 22rem header/timeline
 * reservation (Frame) left under 320px for the player, and the 30rem floor
 * (Spotlight, T13610) forced more height than the sticky ActionBand + 22rem
 * reservation left room for, overflowing the video under the band at scrollTop 0
 * (sticky's "stay fully visible" clamp pulls the band up into the video's own
 * flow region). See FocusModeView.jsx / OverlayModeView.jsx's SHORT_DESKTOP_*
 * constants for the fix (media-gated `!`-important floor overrides, active only
 * below `(min-width:1024px) and (max-height:850px)`).
 *
 * Measures the REAL rendered geometry (not jsdom) against the 'full' dev preset
 * account, which has local data reachable without R2 egress.
 */

async function firstProjectWithVideo(context) {
  const res = await context.request.get('/api/projects');
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.projects || [];
  return list.find((p) => p.has_working_video) || list[0] || null;
}

const SHORT_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
];

for (const vp of SHORT_VIEWPORTS) {
  test.describe(`T14850 short desktop viewport @ ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test.beforeEach(async ({ context }) => {
      test.setTimeout(180_000);
      await loginAsDevPreset(context, 'full');
    });

    test('T14850:C1 Frame player is at least 320px tall', async ({ page, context }) => {
      const project = await firstProjectWithVideo(context);
      test.skip(!project, 'full preset has no working-video project');
      await page.goto(`/focus/p/${project.id}`);
      const stage = page.getByTestId('focus-video-stage');
      await stage.waitFor({ timeout: 90000 });
      // Settle: the --cta-bar-h custom property is set by a ResizeObserver one tick
      // after the action band mounts; the stage's calc()-derived height reflows
      // against it almost immediately, but a short poll avoids a flaky early read.
      await expect(async () => {
        const box = await stage.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(320);
      }).toPass({ timeout: 10000 });
    });

    test('T14850:C2 Spotlight video never sits under the action bar', async ({ page, context }) => {
      const project = await firstProjectWithVideo(context);
      test.skip(!project, 'full preset has no working-video project');
      await page.goto(`/overlay/p/${project.id}`);
      const stage = page.getByTestId('overlay-video-stage');
      await stage.waitFor({ timeout: 90000 });
      const actionBand = page.locator('.sticky.bottom-0.z-30').first();
      // The stage renders at a fallback (uncapped) size until video metadata
      // loads, which can take a while on a throttled sandbox network fetching
      // the real R2-backed clip -- give the poll real headroom rather than
      // treating a slow-but-correct settle as a failure.
      await expect(async () => {
        const box = await stage.boundingBox();
        const abBox = await actionBand.boundingBox();
        expect(box, 'overlay-video-stage has a box').toBeTruthy();
        expect(abBox, 'action band has a box').toBeTruthy();
        // The video's bottom edge must sit at or above the action band's top edge.
        expect(box.y + box.height).toBeLessThanOrEqual(abBox.y + 1);
      }).toPass({ timeout: 60000 });
    });
  });
}
