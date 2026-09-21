import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';

/**
 * T10810 - real-browser proof at a phone viewport that (1) the plays track renders the
 * full rating disc marker (not the old narrow pill) with its start..end span bar, and
 * (2) a selected marker's tooltip disappears once the marker scrolls out of the
 * timeline window, and comes back when it scrolls in.
 */
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE ? Number(process.env.E2E_REAL_PROFILE) : undefined;
const GAME_ID = Number(process.env.E2E_GAME_ID || 7);
const OUT = process.env.T10810_OUT || 'test-results/t10810';

test.describe('T10810 mobile Annotate markers', () => {
  skipOnDeployedTarget(test, 'dev-login is dev-only');
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });

  test('disc marker + span on mobile; tooltip hides when marker scrolls out of view', async ({ context, page }) => {
    test.setTimeout(120_000);
    const logs = [];
    page.on('console', (m) => { if (m.type() !== 'log' && m.type() !== 'info') logs.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) logs.push(`[nav] ${f.url()}`); });
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    await openGameInAnnotate(page, GAME_ID);
    const marker = page.locator('.clip-marker').first();
    await marker.waitFor({ state: 'visible', timeout: 30000 });
    // Let the screen settle (session init can reload /annotate once on entry).
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // (1) full-size disc, no pill
    const disc = marker.locator('svg').first();
    const box = await disc.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(20);
    expect(box.height).toBeGreaterThanOrEqual(20);
    await expect(page.locator('[data-testid="clip-span"]').first()).toBeAttached();

    // (2) select a marker that is INSIDE the scroll window -> tooltip visible
    const inViewIdx = await page.evaluate(() => {
      const v = document.querySelector('.timeline-scroll-container').getBoundingClientRect();
      const els = [...document.querySelectorAll('.clip-marker')];
      return els.findIndex((el) => {
        const r = el.getBoundingClientRect();
        const c = r.left + r.width / 2;
        return c > v.left + 40 && c < v.right - 40;
      });
    });
    expect(inViewIdx).toBeGreaterThanOrEqual(0);
    const target = page.locator('.clip-marker').nth(inViewIdx);
    await target.tap({ force: true });
    await expect(page.locator('[data-testid="clip-marker-tooltip"]')).toBeVisible();
    await page.screenshot({ path: `${OUT}/01-selected-in-view.png`, fullPage: true });

    // scroll the marker out of the window by dragging the touch scrollbar thumb
    // (a programmatic scrollLeft write gets re-anchored by the playhead follow)
    const thumb = page.locator('[data-testid="mobile-scrollbar-thumb"]');
    const tb = await thumb.boundingBox();
    const trackBox = await page.locator('[data-testid="mobile-scrollbar-track"]').boundingBox();
    const dragThumb = async (toX) => {
      const t = await thumb.boundingBox();
      const y = Math.round(t.y + t.height / 2);
      const x0 = t.x + t.width / 2;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x0), y }] });
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x0 + (toX - x0) * (i / 10)), y }] });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
      await page.waitForTimeout(150);
    };
    // Drag toward whichever end of the rail is farther from the thumb.
    const thumbMid = tb.x + tb.width / 2;
    const railMid = trackBox.x + trackBox.width / 2;
    const farEnd = thumbMid < railMid ? trackBox.x + trackBox.width - tb.width / 2 : trackBox.x + tb.width / 2;
    const homeEnd = thumbMid < railMid ? trackBox.x + tb.width / 2 : trackBox.x + trackBox.width - tb.width / 2;
    await dragThumb(farEnd);
    const outOfView = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const v = el.closest('.timeline-scroll-container').getBoundingClientRect();
      const c = r.left + r.width / 2;
      return c < v.left || c > v.right;
    });
    await page.screenshot({ path: `${OUT}/02-scrolled.png`, fullPage: true });
    expect(outOfView).toBe(true);
    await expect(page.locator('[data-testid="clip-marker-tooltip"]')).toHaveCount(0);
    await dragThumb(homeEnd);
    console.log('LOGS: ' + logs.join(' || '));
    await expect(page.locator('[data-testid="clip-marker-tooltip"]')).toBeVisible();
    await page.screenshot({ path: `${OUT}/03-back-in-view.png`, fullPage: true });
  });
});
