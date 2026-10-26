/**
 * T13530: with a 2-video game and several plays (SourceBar row + two-lane timeline), the
 * Mark play / Review plays / Share plays tiles still fit the first viewport at 1440x900 and
 * 1024x768 (T13170 only covered a 1-video game with no plays).
 *
 * Run: bash scripts/dev-verify.sh e2e/T13530-mark-play-two-videos.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 1); // 88min video + appended clip, many plays

async function measure(page) {
  return page.evaluate(() => {
    const byLabel = (re) => [...document.querySelectorAll('button')]
      .find((b) => re.test(b.getAttribute('aria-label') || b.textContent || ''));
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    return {
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      stage: rect(document.querySelector('.video-container')),
      sourceBar: rect(document.querySelector('[data-testid="source-trigger"]')),
      markPlay: rect(document.querySelector('[data-testid="annotate-mark-play-button"]')),
      review: rect(byLabel(/Review plays/)),
      share: rect(byLabel(/Share plays/)),
    };
  });
}

for (const vp of [{ w: 1440, h: 900 }, { w: 1024, h: 768 }]) {
  test(`Mark play, Review plays, Share plays fit on screen on a 2-video game at ${vp.w}x${vp.h}`, async ({ context, page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await openGameInAnnotate(page, GAME_ID);
    await page.locator('.video-container video').first().waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('[data-testid="annotate-mark-play-button"]').waitFor({ timeout: 30000 });
    await page.locator('#preloader').waitFor({ state: 'detached', timeout: 60000 });
    await page.waitForTimeout(1500);
    const m = await measure(page);
    console.log(`[T13530] ${vp.w}x${vp.h} ${JSON.stringify(m)}`);
    expect(m.sourceBar, 'game has 2+ videos (source picker rendered)').not.toBeNull();
    expect(m.scrollY).toBe(0);
    for (const k of ['markPlay', 'review', 'share']) {
      expect(m[k], `${k} rendered`).not.toBeNull();
      expect(m[k].top, `${k} top on screen`).toBeGreaterThanOrEqual(0);
      expect(m[k].bottom, `${k} bottom (${m[k]?.bottom}) <= innerHeight`).toBeLessThanOrEqual(m.innerHeight);
    }
  });
}
