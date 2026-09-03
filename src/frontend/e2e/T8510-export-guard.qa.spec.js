/**
 * T8510 QA — the unframed-clip export guard (Option A, reverses T3700 P0) plus the
 * inline reason caption, live-driven at the phone viewport the walkthrough used.
 *
 * With a Focus draft whose clip has zero user crop keyframes (an un-started draft):
 *   - the Export Focused Video button is DISABLED (no zero-effort credit burn), and
 *   - the reason caption renders AT the button and is visible in-viewport at 390x844
 *     (the 2026-09-02 walkthrough showed the old amber banner scrolled far above the
 *     button on tall panels). Feeds T8550's mobile-CTA assertion set.
 *
 * The disabled/caption matrix (framed -> enabled, multi-clip partial, Overlay-mode
 * unaffected) is proven deterministically in ExportButtonView.test.jsx; the label +
 * honest-ETA rules in GlobalExportIndicator.test.jsx. This spec proves the WIRING
 * on a real account's real unframed draft.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8510-export-guard.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const CAPTION = '[data-testid="export-unframed-caption"]';
const EXPORT_BUTTON = 'button:has-text("Export Focused Video")';

test('T8510: unframed clip disables export with an in-viewport reason at 390x844', async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Needs an UN-STARTED (unframed) draft. FIXTURE-CONTRACT only promises ">=1 framed
  // project", so skip LOUDLY when none is present (same T7750 pattern as T5790's spec).
  const notStarted = page.locator('[data-testid="project-card"]', { hasText: 'Not started' });
  await notStarted.first().waitFor({ timeout: 8000 }).catch(() => {});
  test.skip(
    (await notStarted.count()) === 0,
    '[T8510] no "Not started" framing draft on this account (FIXTURE-CONTRACT gap: needs an un-started draft)',
  );
  await notStarted.first().click();

  const exportBtn = page.locator(EXPORT_BUTTON).first();
  await exportBtn.waitFor({ timeout: 30000 });
  await exportBtn.scrollIntoViewIfNeeded();

  // Guard: zero user keyframes -> the button must be disabled (T3700 reversal).
  await expect(exportBtn, 'export button disabled while the clip is unframed').toBeDisabled();

  // Reason caption renders AT the button and shares the viewport with it on a phone.
  const caption = page.locator(CAPTION).first();
  await expect(caption, 'reason caption rendered under the disabled button').toBeVisible();
  await expect(caption, 'caption in-viewport at 390x844 alongside the button').toBeInViewport();
  await expect(exportBtn, 'button itself still in-viewport with the caption').toBeInViewport();
  const captionText = (await caption.textContent()) || '';
  expect(captionText, 'caption explains the fix, not just the block')
    .toMatch(/Set at least one focus point/);

  await saveEvidence(page, 'T8510-guard-disabled-caption-390x844');
});
