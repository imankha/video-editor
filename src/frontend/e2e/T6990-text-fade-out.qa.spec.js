import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T6990 — REAL BROWSER (chromium) proof that the Overlay text editor preview
 * ramps a region's opacity to 0 over the final TEXT_FADE_OUT_SEC (0.25s) of its
 * `[startTime, endTime)` window, matching the export burn-in envelope
 * (overlay.py `_blend_text_layers`: alpha *= min(1, (end - t) / 0.25)). This is
 * the "preview == export" half of the fix — the burned-video half is covered by
 * the backend alpha-over-time regression in test_t5225_text_burn_in.py.
 *
 * Drives the REAL <TextOverlayPreview> + REAL useTextOverlays hook via the
 * dev-only /textpreviewdiag.html harness (region window [2,4]): reads the live
 * inline `opacity` on the selected element's wrapper as the playhead moves from
 * mid-region (full) into the final 0.25s (ramping down to near-zero).
 *
 * TextOverlayPreview.test.jsx asserts the same opacity numbers in jsdom (an
 * inline style attribute is faithful there); this real-browser run confirms the
 * wiring end-to-end on the actual component the editor mounts.
 *
 * Run: cd src/frontend && npx playwright test e2e/T6990-text-fade-out.qa.spec.js
 */

const HARNESS = '/textpreviewdiag.html';
const STATUS = '[data-testid="status"]';

async function selectedElementId(page) {
  const text = await page.locator(STATUS).textContent();
  const m = text.match(/selectedId=(\S+)/);
  return m && m[1] !== 'none' ? m[1] : null;
}

/** Live inline opacity of the selected element's preview wrapper ('' = full). */
async function selectedOpacity(page, id) {
  const el = page.locator(`[data-testid="text-preview-element-${id}"]`);
  await expect(el).toBeVisible();
  return el.evaluate((node) => node.style.opacity);
}

test('preview fades a text region out over its final 0.25s (matches the export envelope)', async ({ page }) => {
  skipOnDeployedTarget(test, 'drives the dev-only /textpreviewdiag.html harness page, which does not exist in a production BUILD');
  await page.goto(HARNESS);

  // Wait for the harness to create + select the single element (window [2,4]).
  await expect
    .poll(async () => selectedElementId(page), { timeout: 10000 })
    .not.toBeNull();
  const id = await selectedElementId(page);

  // Default currentTime=3 -> 1.0s before the end -> fade == 1 -> no inline opacity.
  expect(await selectedOpacity(page, id)).toBe('');
  await saveEvidence(page, 'T6990-full-opacity-mid-region');

  // currentTime=3.9 -> 0.1s from end -> fade = 0.1/0.25 = 0.4.
  await page.locator('[data-testid="time-fade-mid"]').click();
  const mid = Number(await selectedOpacity(page, id));
  expect(mid).toBeGreaterThan(0.35);
  expect(mid).toBeLessThan(0.45);
  await saveEvidence(page, 'T6990-mid-fade-opacity');

  // currentTime=3.99 -> 0.01s from end -> fade = 0.04 -> nearly transparent.
  await page.locator('[data-testid="time-fade-near"]').click();
  const near = Number(await selectedOpacity(page, id));
  expect(near).toBeLessThan(0.1);
  // Monotonic ramp: nearer the end is more transparent (a real fade, not a cut).
  expect(near).toBeLessThan(mid);
  await saveEvidence(page, 'T6990-near-end-opacity');
});
