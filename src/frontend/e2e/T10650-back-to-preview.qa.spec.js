/**
 * T10650 QA — Focus's "Back to Preview" CTA, live-driven on a real account.
 *
 * When a project's current framing is already rendered (a working video exists
 * and nothing has changed since), the Focus action-band primary CTA reads
 * "Back to Preview" instead of "Generate Framing", and clicking it reopens the
 * already-rendered preview WITHOUT paying to re-render: zero POST to any
 * /api/export/* endpoint (AC2).
 *
 * The four CTA states + the missing-clips guard are proven deterministically in
 * utils/framingCtaState.test.js; the label swap / ghost button / cost-cell copy
 * in components/ExportButtonView.test.jsx; the handler's null-URL toast path in
 * screens/__tests__/focusBackToPreview.test.jsx. This spec proves the WIRING on
 * a real account's real rendered draft.
 *
 * Run: bash scripts/dev-verify.sh e2e/T10650-back-to-preview.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const BACK_TO_PREVIEW = 'button:has-text("Back to Preview")';

test('T10650: an already-rendered framing shows "Back to Preview" and reopens with no new export POST', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Count every export POST so we can prove re-entry starts NO render (AC2).
  let exportPosts = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/export\//.test(req.url())) exportPosts += 1;
  });

  // Needs a project whose current framing is already rendered (a working video,
  // no unrendered edits). Skip LOUDLY when none is present rather than fabricate
  // one (same FIXTURE-CONTRACT skip pattern as T8510/T5790).
  const rendered = page.locator('[data-testid="project-card"]', { hasText: 'Ready' });
  await rendered.first().waitFor({ timeout: 8000 }).catch(() => {});
  test.skip(
    (await rendered.count()) === 0,
    '[T10650] no already-rendered project on this account (FIXTURE-CONTRACT gap: needs a project with a working video)',
  );
  await rendered.first().click();

  const backBtn = page.locator(BACK_TO_PREVIEW).first();
  await backBtn.waitFor({ timeout: 30000 });
  await backBtn.scrollIntoViewIfNeeded();
  await expect(backBtn, 'primary CTA reads "Back to Preview" for an unchanged render').toBeVisible();

  await saveEvidence(page, 'T10650-back-to-preview-cta');

  const before = exportPosts;
  await backBtn.click();

  // The completion preview + four-choice action bar reopens (same surface the
  // post-render preview uses).
  await expect(
    page.locator('[data-testid="focus-publish-action-bar"]'),
    'clicking Back to Preview reopens the completion preview action bar',
  ).toBeVisible({ timeout: 15000 });

  // AC2: zero credits, zero render — no /api/export/* POST fired on re-entry.
  await page.waitForTimeout(1000);
  expect(exportPosts, 'Back to Preview must not start any export render').toBe(before);

  await saveEvidence(page, 'T10650-preview-reopened-no-export');
});
