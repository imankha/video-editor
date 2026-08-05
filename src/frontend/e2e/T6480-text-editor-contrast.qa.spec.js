import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T6480 — REAL BROWSER contrast proof for the SHARED TextSpecEditor rail. The
 * component is dark-surface tuned (text-gray-400 labels, gray-800 inputs, amber
 * footer). On the Overlay screen it was hosted on a LIGHT glass panel
 * (bg-white/10 over the purple app bg), rendering labels bright-on-bright (the
 * report). The fix darkens the OVERLAY HOST panel (leaving the shared component
 * untouched, so the already-dark card editor cannot regress).
 *
 * Drives /textspecdiag.html, which mounts the REAL TextSpecEditor three ways over
 * a representative purple app background: overlay-before (light, the bug),
 * overlay-after (dark, the fix), and card-host (dark, unchanged). We compute the
 * WCAG contrast ratio of a label against the panel background COMPOSITED over the
 * app bg, and assert the fix meets the 4.5:1 floor while the old surface did not.
 *
 * A contrast bug cannot be proven in jsdom (no layout/paint) — this is the
 * required real-browser evidence.
 *
 * Run: cd src/frontend && npx playwright test e2e/T6480-text-editor-contrast.qa.spec.js
 */

const HARNESS = '/textspecdiag.html';
const CONTRAST_FLOOR = 4.5; // WCAG AA for normal text (style guide: "4.5:1 for text")
// Representative app background behind the translucent panels (the lighter stop of
// the overlay screen's purple gradient — the conservative/worst case for BEFORE).
const APP_BG = [76, 29, 149];

/**
 * In-page: compute the WCAG contrast of a named label against its panel's
 * background, compositing the (often translucent) panel colour over APP_BG.
 */
async function labelContrast(page, testid, labelText) {
  return page.evaluate(({ testid, labelText, base }) => {
    const parseRGBA = (s) => {
      const m = (s.match(/[\d.]+/g) || []).map(Number);
      return [m[0] || 0, m[1] || 0, m[2] || 0, m.length > 3 ? m[3] : 1];
    };
    const composite = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); };

    const panel = document.querySelector(`[data-testid="${testid}"]`);
    if (!panel) throw new Error(`panel ${testid} not found`);
    const label = [...panel.querySelectorAll('span, summary')].find(
      (el) => el.textContent.trim().toLowerCase() === labelText.toLowerCase()
    );
    if (!label) throw new Error(`label "${labelText}" not found in ${testid}`);

    const panelBg = parseRGBA(getComputedStyle(panel).backgroundColor);
    const labelColor = parseRGBA(getComputedStyle(label).color);
    const effectiveBg = composite(panelBg, base);
    return Math.round(ratio(labelColor, effectiveBg) * 100) / 100;
  }, { testid, labelText, base: APP_BG });
}

test.describe('T6480 — TextSpecEditor label contrast in both hosts', () => {
  skipOnDeployedTarget(test, 'drives the dev-only /textspecdiag.html harness page, which does not exist in a production BUILD');

  test('the OLD overlay light panel FAILED the contrast floor (bug reproduced)', async ({ page }) => {
    await page.goto(HARNESS);
    await expect(page.locator('[data-testid="overlay-before"]')).toBeVisible();
    const before = await labelContrast(page, 'overlay-before', 'Font');
    expect(before, `old light panel label contrast was ${before}:1`).toBeLessThan(CONTRAST_FLOOR);
  });

  test('the FIXED overlay dark panel MEETS the contrast floor', async ({ page }) => {
    await page.goto(HARNESS);
    await expect(page.locator('[data-testid="overlay-after"]')).toBeVisible();
    const after = await labelContrast(page, 'overlay-after', 'Font');
    expect(after, `fixed dark panel label contrast is ${after}:1`).toBeGreaterThanOrEqual(CONTRAST_FLOOR);

    // And it is a real improvement over the old surface.
    const before = await labelContrast(page, 'overlay-before', 'Font');
    expect(after).toBeGreaterThan(before);
  });

  test('the card editor host is unchanged and STILL meets the floor (no regression)', async ({ page }) => {
    await page.goto(HARNESS);
    await expect(page.locator('[data-testid="card-host"]')).toBeVisible();
    const card = await labelContrast(page, 'card-host', 'Font');
    expect(card, `card host label contrast is ${card}:1`).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });

  test('the amber footer note also clears the floor on the fixed overlay panel', async ({ page }) => {
    await page.goto(HARNESS);
    // The footer note is the overlay-only "burned into the export" paragraph.
    const contrast = await page.evaluate((base) => {
      const parseRGBA = (s) => { const m = (s.match(/[\d.]+/g) || []).map(Number); return [m[0] || 0, m[1] || 0, m[2] || 0, m.length > 3 ? m[3] : 1]; };
      const composite = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
      const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); };
      const panel = document.querySelector('[data-testid="overlay-after"]');
      const note = [...panel.querySelectorAll('p')].find((p) => /burned into the exported/i.test(p.textContent));
      if (!note) throw new Error('footer note not found');
      const eff = composite(parseRGBA(getComputedStyle(panel).backgroundColor), base);
      return Math.round(ratio(parseRGBA(getComputedStyle(note).color), eff) * 100) / 100;
    }, APP_BG);
    expect(contrast, `footer note contrast ${contrast}:1`).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });
});

test.describe('T6480 — before/after evidence at desktop and 375px', () => {
  skipOnDeployedTarget(test, 'drives the dev-only /textspecdiag.html harness page, which does not exist in a production BUILD');

  test('desktop before/after/card screenshots', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(HARNESS);
    await expect(page.locator('[data-testid="overlay-after"]')).toBeVisible();
    await saveEvidence(page, 'T6480-desktop-before-after-card');
  });

  test('375px before/after/card screenshots', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(HARNESS);
    await expect(page.locator('[data-testid="overlay-after"]')).toBeVisible();
    await saveEvidence(page, 'T6480-375px-before-after-card');
  });
});
