import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

/**
 * T5672 visual verification: solid circular arrow buttons must be clearly
 * visible at a glance over bright poster images (the prior gradient-chevron
 * design was reported invisible). Screenshots at 1315px and 1795px.
 */
async function verifyArrows(context, page, width) {
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });
  await page.waitForLoadState('networkidle');

  const rightArrow = page.locator('button[aria-label="Scroll right"]').first();
  await expect(rightArrow).toBeVisible({ timeout: 5000 });

  const box = await rightArrow.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      width: r.width,
      height: r.height,
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      color: style.color,
    };
  });
  console.log(`[${width}px] Right arrow box:`, JSON.stringify(box));

  expect(box.width).toBeGreaterThanOrEqual(34);
  expect(box.height).toBeGreaterThanOrEqual(34);
  expect(box.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(box.boxShadow).not.toBe('none');

  await page.screenshot({ path: `/tmp/t5672-arrows-${width}.png` });
  console.log(`Screenshot saved: /tmp/t5672-arrows-${width}.png`);
}

test(`T5672 arrows visible at 1315px`, async ({ context, page }) => {
  await verifyArrows(context, page, 1315);
});

test(`T5672 arrows visible at 1795px`, async ({ context, page }) => {
  await verifyArrows(context, page, 1795);
});
