/**
 * T13170: at 1440x900 and 1024x768 the Annotate action-tile row (Mark play first) fits in
 * the first viewport with no page scroll, in the watch state and while the video plays, and
 * the guide never shows "Scroll down to continue" there.
 *
 * Run: bash scripts/dev-verify.sh e2e/T13170-mark-play-on-screen.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 12); // "clip": fresh game, live video, no plays (the watch/playing guides)

async function measure(page) {
  return page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    return {
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      stage: rect('.video-container'),
      markPlay: rect('[data-testid="annotate-mark-play-button"]'),
      pill: !!document.querySelector('[data-testid="guidance-scroll-hint"]'),
    };
  });
}

function expectOnScreen(m, label) {
  console.log(`[T13170] ${label} ${JSON.stringify(m)}`);
  expect(m.markPlay, `${label}: Mark play rendered`).not.toBeNull();
  expect(m.scrollY, `${label}: no page scroll`).toBe(0);
  expect(m.markPlay.top, `${label}: Mark play top on screen`).toBeGreaterThanOrEqual(0);
  expect(m.markPlay.bottom, `${label}: Mark play bottom on screen`).toBeLessThanOrEqual(m.innerHeight);
  expect(m.pill, `${label}: no "Scroll down to continue" pill`).toBe(false);
}

for (const vp of [{ w: 1440, h: 900 }, { w: 1024, h: 768 }]) {
  test(`Mark play is fully on screen in the watch and playing states at ${vp.w}x${vp.h}`, async ({ context, page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await openGameInAnnotate(page, GAME_ID);
    await page.locator('.video-container video').first().waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('[data-testid="annotate-mark-play-button"]').waitFor({ timeout: 30000 });
    // Guidance on, so the guide can show its scroll pill (put back as found at the end).
    await page.locator('#preloader').waitFor({ state: 'detached', timeout: 60000 });
    const toggle = page.getByTestId('guidance-toggle').first();
    const wasOn = (await toggle.getAttribute('aria-checked')) === 'true';
    if (!wasOn) await toggle.click();
    try {
      await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 10000 });
      // The watch guide names Mark play, so the pill check below is not vacuous.
      await expect(page.getByTestId('floating-coach-host')).toContainText('Mark play', { timeout: 20000 });
      await page.waitForTimeout(1000); // the coach measures on rAF/scroll/resize
      expectOnScreen(await measure(page), `watch ${vp.w}x${vp.h}`);

      await page.keyboard.press('Space');
      await page.waitForTimeout(1500);
      expectOnScreen(await measure(page), `playing ${vp.w}x${vp.h}`);
      await page.keyboard.press('Space');
    } finally {
      if (!wasOn) await toggle.click();
    }
  });
}
