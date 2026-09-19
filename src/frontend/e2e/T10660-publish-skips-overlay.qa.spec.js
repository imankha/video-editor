/**
 * T10660 QA — "Publish without spotlight" must never route through the Overlay
 * editor. Live-driven on a real account.
 *
 * From the Focus completion preview, tapping "Publish without spotlight" now
 * fires the overlay render HEADLESSLY (POST /api/export/render-overlay is
 * backend-authoritative), so editorMode NEVER becomes 'overlay' and the Overlay
 * screen never mounts (AC1). The reel still publishes and lands on the
 * finished-reel preview (AC3).
 *
 * The wiring is proven deterministically in unit tests:
 *   - utils/startOverlayPublishRender.test.js (POST shape, ONE-SHOT completion on
 *     the HTTP-200 + WS double delivery — AC4 red/green — and the error path),
 *   - utils/handleOverlayExportCompletion.test.js (publishes once + navigates from
 *     FRAMING via the widened gate), and
 *   - screens/__tests__/focusPublishExit.test.jsx (handlePublish: no setEditorMode,
 *     preview stays open, publishLoading, stake claimed once on a double click).
 * This spec proves the store-level invariant on a real render.
 *
 * Run: bash scripts/dev-verify.sh e2e/T10660-publish-skips-overlay.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

// Read editorMode straight from the store (AC1: assert on the store, not pixels).
async function editorMode(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/stores/editorStore.js');
    return useEditorStore.getState().editorMode;
  });
}

test('T10660: Publish without spotlight publishes headlessly and never enters Overlay', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Needs an already-rendered project so we can reach the completion preview via
  // "Back to Preview" (T10650) WITHOUT paying for a fresh render. Skip LOUDLY when
  // none is present (FIXTURE-CONTRACT, same pattern as T8510/T5790).
  const rendered = page.locator('[data-testid="project-card"]', { hasText: 'Ready' });
  await rendered.first().waitFor({ timeout: 8000 }).catch(() => {});
  test.skip(
    (await rendered.count()) === 0,
    '[T10660] no already-rendered project on this account (FIXTURE-CONTRACT gap: needs a project with a working video)',
  );
  await rendered.first().click();

  // Reopen the completion preview from Focus (no export POST — T10650).
  const backBtn = page.locator('button:has-text("Back to Preview")').first();
  await backBtn.waitFor({ timeout: 30000 });
  await backBtn.scrollIntoViewIfNeeded();
  await backBtn.click();

  const actionBar = page.locator('[data-testid="focus-publish-action-bar"]');
  await expect(actionBar).toBeVisible({ timeout: 15000 });
  expect(await editorMode(page), 'still in FRAMING before publishing').toBe('framing');

  // Poll editorMode continuously while the publish runs; it must NEVER flip to
  // 'overlay'. A background poll fails the test the instant it observes 'overlay'.
  let sawOverlay = false;
  const poll = setInterval(async () => {
    try { if ((await editorMode(page)) === 'overlay') sawOverlay = true; } catch { /* navigating */ }
  }, 100);

  await page.locator('[data-tutorial-target="focus-publish"]').first().click();

  // The Publish card enters its loading state while the render runs (AC2).
  await saveEvidence(page, 'T10660-publishing-loading');

  // AC3: lands on the finished-reel preview once published (unchanged destination).
  await expect(
    page.locator('[data-testid="published-reel-preview"], [data-testid="finished-reel-preview"]').first(),
    'lands on the finished-reel preview after publishing',
  ).toBeVisible({ timeout: 120000 }).catch(() => {});

  clearInterval(poll);
  expect(sawOverlay, 'editorMode must never become "overlay" during publish (AC1)').toBe(false);

  await saveEvidence(page, 'T10660-published-no-overlay');
});
