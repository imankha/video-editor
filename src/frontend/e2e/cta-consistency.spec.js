import { test, expect } from '@playwright/test';

/**
 * T12010 -- cross-screen CTA consistency spec.
 *
 * Table-driven: each screen row opens a screen that renders <CtaBar> and
 * assertCtaBar() checks the shared contract. Later tasks (T12020-T12100) add
 * their screens to SCREENS; this task ships the harness.
 *
 * Contract (per viewport):
 *   - a [data-testid=cta-bar] exists
 *   - its first [data-cta-role] is "primary" and there is exactly one primary
 *   - primary is the leftmost action at 1440 and the topmost at 390
 *   - no horizontal overflow at 320-768
 *
 * Row shape: { name, open: async (page) => void }  (open navigates to the screen)
 */
export const SCREENS = [];

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const OVERFLOW_WIDTHS = [320, 390, 480, 768];

export async function assertCtaBar(page, name) {
  const bar = page.locator('[data-testid="cta-bar"]').first();
  await expect(bar, `${name}: cta-bar exists`).toBeVisible({ timeout: 10000 });
  const roles = await bar.locator('[data-cta-role]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cta-role')));
  expect(roles[0], `${name}: first role`).toBe('primary');
  expect(roles.filter((r) => r === 'primary'), `${name}: single primary`).toHaveLength(1);

  const boxes = await bar.locator('[data-cta-role]').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { role: e.getAttribute('data-cta-role'), x: r.x, y: r.y };
  }));
  const viewport = page.viewportSize();
  const primary = boxes.find((b) => b.role === 'primary');
  const others = boxes.filter((b) => b.role !== 'primary');
  if (viewport.width >= 1024) {
    others.forEach((b) => expect(primary.x, `${name}: primary leftmost`).toBeLessThanOrEqual(b.x));
  } else if (viewport.width <= 480) {
    others.forEach((b) => expect(primary.y, `${name}: primary topmost`).toBeLessThanOrEqual(b.y));
  }
}

export async function assertNoHorizontalOverflow(page, name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name}: horizontal overflow`).toBeLessThanOrEqual(0);
}

test.describe('CTA consistency', () => {
  test('SCREENS rows are well-formed', () => {
    for (const s of SCREENS) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.open).toBe('function');
    }
  });

  for (const screen of SCREENS) {
    test(`${screen.name}: desktop 1440`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await screen.open(page);
      await assertCtaBar(page, screen.name);
    });

    test(`${screen.name}: mobile 390`, async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await screen.open(page);
      await assertCtaBar(page, screen.name);
    });

    for (const width of OVERFLOW_WIDTHS) {
      test(`${screen.name}: no overflow at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await screen.open(page);
        await assertNoHorizontalOverflow(page, screen.name);
      });
    }
  }
});
