/**
 * T8120 QA — the onboarding quest/help panel must NEVER occlude an open modal.
 *
 * Bug (reproduced twice @390x844, screenshots mobile-02/mobile-05): the expanded
 * "Get Started" quest panel sat ON TOP of the open Add Game modal — it was
 * `fixed z-50`, the same rung as GameDetailsModal (`fixed inset-0 z-50`), and it
 * rendered LATER in the DOM, so it won the stacking tie and painted over the
 * modal's video dropzone. A real thumb tap on the dropzone landed on the quest
 * panel's pushed "Watch tutorial" button instead of the file picker.
 *
 * Fix (T8120): the quest/help panel auto-hides FULLY whenever any modal overlay is
 * open (occlusion contract), and z-orders BENEATH modals (Z.DROPDOWN, below
 * Z.MODAL) as defense in depth. So with the Add Game modal open there is no quest
 * surface over it, and the dropzone is hit-testable.
 *
 * Drives the REAL modal via the empty-session test-login bypass (the actual
 * new-user, zero-games surface — the exact cohort with an active onboarding quest),
 * so it runs deterministically anywhere chromium is installed. It emulates the
 * iPhone 12/13 VIEWPORT only (chromium engine) — the honest limit documented in
 * playwright.config.js.
 *
 * Anti-vacuous: the test first confirms the quest panel IS present on the home
 * screen (so it has something to occlude with), then asserts it disappears and the
 * dropzone hit-tests to the modal once the modal opens. Revert the auto-hide and
 * the quest overlay stays in the DOM over the modal and the hit-test flips.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8120-quest-overlay-modal-occlusion.qa.spec.js
 */
import { test, expect } from '@playwright/test';

const VIEWPORT = { width: 390, height: 844 }; // the exact reproduced viewport

async function loginEmptySession(context, page) {
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  await page.goto('/home/games', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/auth/test-login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    });
  });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });
  await page.goto('/home/games', { waitUntil: 'domcontentloaded' });
}

test('quest/help panel does not occlude the Add Game modal at 390x844', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    browserName: 'chromium',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();

  await loginEmptySession(context, page);

  // The Add Game CTA is the empty-state control on the Games tab.
  const addCta = page.getByRole('button', { name: /^Add Game$/ }).first();
  await addCta.waitFor({ state: 'visible', timeout: 30000 });

  // Anti-vacuous precondition: the onboarding quest/help surface is present on the
  // home screen before any modal opens (otherwise there is nothing to occlude with).
  const questOverlay = page.locator('.quest-overlay');
  await expect(questOverlay.first()).toBeVisible({ timeout: 15000 });

  // Open the modal.
  await addCta.click();
  await expect(page.getByText('Add New Game')).toBeVisible();

  // 1) Occlusion contract: the quest/help surface auto-hides fully while the modal
  //    is open — no quest overlay remains in the DOM over the modal.
  await expect(questOverlay).toHaveCount(0);

  // 2) The dropzone is genuinely hit-testable: elementFromPoint at its center
  //    resolves to a node INSIDE the modal, never a quest-panel node.
  const dropzone = page.getByText('Drop your whole game here');
  await expect(dropzone).toBeVisible();
  const box = await dropzone.boundingBox();
  expect(box).not.toBeNull();
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return { inQuestPanel: true, inModal: false };
    return {
      inQuestPanel: !!el.closest('[data-quest-panel], .quest-overlay'),
      // The GameDetailsModal root is the only full-screen fixed inset-0 overlay open here.
      inModal: !!el.closest('.fixed.inset-0'),
    };
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

  expect(hit.inQuestPanel, 'dropzone tap must not land on the quest/help panel').toBe(false);
  expect(hit.inModal, 'dropzone tap must land inside the Add Game modal').toBe(true);

  await context.close();
});
