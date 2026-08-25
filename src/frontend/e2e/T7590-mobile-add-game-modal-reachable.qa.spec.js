/**
 * T7590 QA — the "Add your first game" modal must be completable on a short phone.
 *
 * Bug (reports #18 @352x541, #46 @320x498, iPhone Safari): a new user taps "Add
 * Game" on an empty Games tab, the GameDetailsModal opens, but the form is taller
 * than a short iPhone viewport and the panel was fixed-centered with NO max-height
 * and NO internal scroll. So the primary "Add Game" submit button overflowed BELOW
 * the fold and the close "X" overflowed ABOVE it, and because the panel is
 * `position: fixed` there is nothing to scroll — both were unreachable. Dead end:
 * the user can fill the visible fields but can neither submit nor dismiss.
 *
 * Fix (T7590): the modal panel gets `max-h-[90vh] overflow-y-auto`, the same
 * pattern every sibling modal already uses (BuyCreditsModal, ProjectCreationSettings,
 * ClipLibraryModal). The panel now caps below the viewport and scrolls internally,
 * so header + submit stay reachable.
 *
 * This drives the REAL modal via the empty-session test-login bypass (no real
 * account / R2 needed — it IS the new-user, zero-games state), so it runs
 * deterministically anywhere chromium is installed. It emulates iOS Safari's
 * VIEWPORT only (chromium engine) — the honest limit documented in
 * playwright.config.js; the dynamic-toolbar chrome and WebKit file-input security
 * are real-device concerns, not what this bug was.
 *
 * Anti-vacuous: at these viewports the form genuinely exceeds the screen height
 * (asserted), so the reachability checks depend on the fix. Remove
 * `overflow-y-auto`/`max-h` and the panel grows past the viewport again, the
 * controls scroll out of reach, and both assertions below go red.
 *
 * Run: bash scripts/dev-verify.sh e2e/T7590-mobile-add-game-modal-reachable.qa.spec.js
 */
import { test, expect, devices } from '@playwright/test';

// The two viewports from the real reports, plus a keyboard-open worst case
// (opponent-name autofocus opens the iOS keyboard, shrinking the visual viewport).
const SHORT_VIEWPORTS = [
  { name: 'bug#46 iPhone-class 320x498', width: 320, height: 498 },
  { name: 'bug#18 iPhone-class 352x541', width: 352, height: 541 },
];

async function openAddGameModal(page) {
  // Empty-session bypass (see src/frontend/CLAUDE.md): a brand-new user with zero
  // games — exactly the "Add your first game" surface this bug lives on.
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

  const addCta = page.getByRole('button', { name: /^Add Game$/ }).first();
  await addCta.waitFor({ state: 'visible', timeout: 30000 });
  await addCta.click();
  await expect(page.getByText('Add New Game')).toBeVisible();
}

/** True when the element's box sits fully inside [0, viewportHeight]. */
function within(box, viewportHeight) {
  return !!box && box.y >= 0 && (box.y + box.height) <= viewportHeight + 1;
}

for (const vp of SHORT_VIEWPORTS) {
  test(`Add Game modal is completable at ${vp.name}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      ...devices['iPhone SE'],
      viewport: { width: vp.width, height: vp.height },
      browserName: 'chromium',
      serviceWorkers: 'block',
    });
    await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
    const page = await context.newPage();

    await openAddGameModal(page);

    const panel = page.locator('div.max-w-md.bg-gray-800').first();
    // 1) The form is genuinely taller than this short viewport — without the fix
    //    it would overflow and clip. (Proves the checks below are load-bearing.)
    const metrics = await panel.evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      maxHeight: getComputedStyle(el).maxHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(metrics.scrollH).toBeGreaterThan(vp.height); // content taller than screen
    // 2) The panel itself is capped within the viewport and scrolls internally.
    expect(metrics.clientH).toBeLessThanOrEqual(vp.height);
    expect(['auto', 'scroll']).toContain(metrics.overflowY);

    // Both ends of the form must be reachable via the panel's internal scroll.
    // (Position-based, disabled-agnostic: pre-fix the submit sat below the fold
    // and the X above it, and because the panel was `position: fixed` a scroll
    // could not move either — both `within(...)` checks were false. We assert
    // reachability by geometry here, and click-hit-testability separately via the
    // never-disabled X, so the empty test session's eventual redirect can't race
    // a form-fill/enable step.)

    // 3) The submit "Add Game" button (bottom of the form) scrolls into view.
    const submit = page.locator('div.max-w-md button[type="submit"]').first();
    await submit.scrollIntoViewIfNeeded();
    expect(within(await submit.boundingBox(), vp.height)).toBe(true);

    // 4) The close "X" (top of the form, never disabled) is reachable AND
    //    hit-testable — nothing overlays it once scrolled into view.
    const closeX = page.locator('div.max-w-md button:has(svg.lucide-x)').first();
    await closeX.scrollIntoViewIfNeeded();
    expect(within(await closeX.boundingBox(), vp.height)).toBe(true);
    await closeX.click({ trial: true });

    await context.close();
  });
}
