/**
 * T12630: with the Focus "Tap Play" step showing, the Play button is cut out of the
 * guide shade: elementFromPoint at its center returns the button itself (not the
 * shade or the action band), so it is full brightness and clickable.
 *
 * Run: bash scripts/dev-verify.sh e2e/T12630-play-above-shade.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { createUnframedDraft, deleteClip } from './helpers/annotateClips.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

let createdClipId = null;
test.afterEach(async ({ context }) => {
  if (createdClipId) { await deleteClip(context, createdClipId); createdClipId = null; }
});

for (const vp of [{ w: 1440, h: 900 }, { w: 1024, h: 768 }]) {
  test(`Play button is above the guide shade on Step 2 at ${vp.w}x${vp.h}`, async ({ context, page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    const { rawClipId, name } = await createUnframedDraft(context, { profileId: REAL_PROFILE });
    createdClipId = rawClipId;
    await page.goto('/');
    await page.getByText(name.slice(0, 18), { exact: false }).first().click();
    await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });

    // Step 1 -> drag the box -> Step 2 names Play.
    const box = page.locator('[data-testid="focus-video-stage"] .cursor-move').first();
    const b = await box.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 25, b.y + b.height / 2 + 10, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByText('Tap Play and watch your athlete.')).toBeVisible();
    await expect(page.locator('[data-testid="guide-shade"]')).toBeVisible();
    const play = page.locator('[data-testid="play-button"]');
    await expect(play).toBeVisible();
    const hit = await play.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === el || el.contains(top));
    });
    expect(hit, 'elementFromPoint at Play center is the button, not the shade/band').toBe(true);
  });
}
