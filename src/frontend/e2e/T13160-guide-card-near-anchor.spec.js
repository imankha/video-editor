/**
 * T13160: the guide card sits within 250 px of the control it names, without covering it:
 *   - Home Clips drafts ("Pick up where you left off"): the pulsing first draft tile.
 *   - Annotate play editor ("Drag the green ends ... tap Done"): the Done button.
 * Distance = gap between the card box and the control box (0 = touching). Writes one play to the
 * fixture game for the editor test; deleted in finally.
 *
 * Run: bash scripts/dev-verify.sh e2e/T13160-guide-card-near-anchor.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { deleteClip } from './helpers/annotateClips.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 12);
const NEAR_PX = 250;

async function setGuidance(page, on) {
  await page.locator('#preloader').waitFor({ state: 'detached', timeout: 60000 });
  const toggle = page.getByTestId('guidance-toggle').first();
  await toggle.waitFor({ timeout: 30000 });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on), { timeout: 10000 });
}

/** Gap between the coach card and `selector`'s box, and whether they overlap. */
async function gap(page, selector, label) {
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="floating-coach-host"]');
    return host && host.style.visibility !== 'hidden' && host.textContent.trim();
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  const m = await page.evaluate((sel) => {
    const card = document.querySelector('[data-testid="floating-coach-host"]').getBoundingClientRect();
    const el = document.querySelector(sel).getBoundingClientRect();
    const dx = Math.max(el.left - card.right, card.left - el.right, 0);
    const dy = Math.max(el.top - card.bottom, card.top - el.bottom, 0);
    const overlaps = card.left < el.right && card.right > el.left && card.top < el.bottom && card.bottom > el.top;
    return { gap: Math.round(Math.hypot(dx, dy)), overlaps, card: [card.left, card.top, card.right, card.bottom].map(Math.round), el: [el.left, el.top, el.right, el.bottom].map(Math.round) };
  }, selector);
  console.log(`[T13160] ${label} ${JSON.stringify(m)}`);
  expect(m.overlaps, `${label}: card does not cover the control`).toBe(false);
  expect(m.gap, `${label}: card within ${NEAR_PX}px of the control`).toBeLessThanOrEqual(NEAR_PX);
}

for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
  test.describe(`${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('Home Clips drafts: card near the pulsing first draft tile', async ({ context, page }) => {
      test.setTimeout(120_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      await page.goto('/');
      await setGuidance(page, true);
      // The Games step's shade can sit over the tab at some widths; switch tabs with a DOM click, as the guide's own Got it would.
      await page.getByTestId('home-tab-clips').evaluate(el => el.click());
      await page.locator('.coach-target-pulse').first().waitFor({ timeout: 20000 });
      await gap(page, '.coach-target-pulse', `home clips ${width}x${height}`);
    });

    test('Annotate play editor: card near Done', async ({ context, page }) => {
      test.setTimeout(180_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      let rawClipId = null;
      try {
        await openGameInAnnotate(page, GAME_ID);
        await page.getByTestId('annotate-mark-play-button').waitFor({ timeout: 60000 });
        await setGuidance(page, true);
        const saved = page.waitForResponse(res => /\/clips\/raw\/save/.test(res.url()) && res.request().method() === 'POST', { timeout: 30000 });
        await page.getByTestId('annotate-mark-play-button').click();
        rawClipId = (await (await saved).json()).raw_clip_id;
        await page.getByTestId('play-editor-done').waitFor({ timeout: 20000 });
        await gap(page, '[data-testid="play-editor-done"]', `annotate editor ${width}x${height}`);
      } finally {
        await deleteClip(context, rawClipId);
      }
    });
  });
}
