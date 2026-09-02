import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T6180 — a ready Draft Reel now has a real primary action. Real-browser evidence.
 *
 * Acceptance criteria (task file):
 *   (1) "Ready" is a NON-interactive badge; the primary action reads as an action and
 *       names the verb ("Move to Highlight Reels").
 *   (2) Play is a visible secondary action; the remaining actions live in a kebab and
 *       all still work.
 *   (3) A tile click in the ready state PREVIEWS (the inert-tile behaviour is gone).
 *   (4) Two-click delete keeps the menu open on the first click (verified WITHOUT
 *       actually deleting); the publish-retry path stays on the tile (unit-covered).
 *   (5) 375px + desktop, non-ready (exporting) and published tile states unregressed.
 *
 * This spec is deliberately NON-DESTRUCTIVE: it never completes a publish and never
 * confirms a delete, so the real account's reels are untouched. If the live account has
 * no ready-but-unpublished reel right now, it client-side route-injects one (rewriting
 * only the /api/projects response in the browser — no backend write) so the
 * presentational change is still verifiable.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T6180-ready-tile-primary-action.qa.spec.js
 */
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';

async function gotoDrafts(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const draftsTab = page.locator('button:has-text("Clips")');
  await expect(draftsTab, 'Clips tab renders').toBeVisible({ timeout: 30000 });
  await draftsTab.click();
  await page.waitForTimeout(800); // let carousels + posters settle
}

// A ready tile = a project-card that contains the primary "Move to Highlight Reels" button.
const readyTile = (page) =>
  page.locator('[data-testid="project-card"]', {
    has: page.getByRole('button', { name: 'Move to Highlight Reels' }),
  });

// Guarantee a ready tile exists. Prefer a live one; otherwise flip the first real
// project into the ready state in the browser ONLY (no backend mutation).
async function ensureReadyTile(page) {
  if (await readyTile(page).count()) return 'live';
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const resp = await route.fetch();
    let projects;
    try { projects = await resp.json(); } catch { return route.fulfill({ response: resp }); }
    if (Array.isArray(projects) && projects.length) {
      projects[0] = {
        ...projects[0],
        has_final_video: true,
        is_published: false,
        final_video_id: projects[0].final_video_id || 999999,
      };
    }
    await route.fulfill({ response: resp, json: projects });
  });
  await gotoDrafts(page);
  await expect(readyTile(page).first(), 'a ready tile is present after injection').toBeVisible({ timeout: 15000 });
  return 'injected';
}

test('T6180 ready draft tile exposes a discoverable primary action', async ({ context, page }) => {
  test.setTimeout(180000);
  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);

  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoDrafts(page);
  await assertNoHorizontalOverflow(page);

  const source = await ensureReadyTile(page);
  console.log(`[qa] ready-tile source: ${source}`);
  const tile = readyTile(page).first();
  await expect(tile).toBeVisible();
  await tile.scrollIntoViewIfNeeded();

  // ---- Criterion 1: "Ready" is a status badge (not a control); primary names the verb.
  await expect(tile.getByText('Ready', { exact: true }), '"Ready" status badge renders').toBeVisible();
  expect(
    await tile.getByRole('button', { name: /^ready$/i }).count(),
    '"Ready" is NOT a button anymore'
  ).toBe(0);
  const primary = tile.getByRole('button', { name: 'Move to Highlight Reels' });
  await expect(primary, 'primary action names the verb').toBeVisible();
  await expect(primary).toBeEnabled();
  await saveEvidence(page, 'criterion-1-ready-badge-and-primary');

  // ---- Criterion 2: Play visible; the rest live behind a working kebab.
  await expect(tile.getByRole('button', { name: 'Preview video' }), 'Play/Preview is a visible secondary').toBeVisible();
  const kebab = tile.getByRole('button', { name: 'More actions' });
  await expect(kebab).toBeVisible();
  await kebab.click();
  // Scope to the open menu: getByRole name is substring-by-default in Playwright, and
  // other tiles' hover rails carry "Rename reel"/"Delete reel" buttons.
  const menu = page.getByTestId('draft-kebab-menu');
  await expect(menu).toBeVisible();
  for (const label of ['Rename', 'Open in Framing', 'Open in Overlay', 'Delete reel']) {
    await expect(menu.getByRole('button', { name: label, exact: true }), `kebab item: ${label}`).toBeVisible();
  }
  await saveEvidence(page, 'criterion-2-kebab-open');

  // ---- Criterion 4 (done while the menu is open): two-click delete stays open on the
  // first click. We ARM the confirm and verify it, then DISMISS — never confirming, so
  // the reel is not deleted.
  await menu.getByRole('button', { name: 'Delete reel', exact: true }).click();
  await expect(menu.getByRole('button', { name: 'Click again to confirm', exact: true }), 'first delete click keeps the menu open + arms confirm').toBeVisible();
  await saveEvidence(page, 'criterion-4-delete-armed-not-confirmed');
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(5, 5); // click outside -> close the menu without confirming
  await page.waitForTimeout(200);

  // ---- Criterion 3: a tile-body tap PREVIEWS (was inert). Click the poster area, not a button.
  const box = await tile.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 30);
  await expect(page.locator('.fixed.inset-4'), 'body tap opens the preview modal').toBeVisible({ timeout: 10000 });
  await saveEvidence(page, 'criterion-3-body-tap-previews');
  // Close the modal via its backdrop.
  await page.locator('.fixed.inset-0.bg-black\\/80').first().click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.fixed.inset-4')).toHaveCount(0);

  // ---- Criterion 5: responsive sweep (375 + desktop) over the drafts view, which also
  // shows non-ready tiles unregressed alongside the ready one.
  await responsiveSweep(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Published state unregressed: Highlight Reels tiles still render.
  const myReelsTab = page.locator('button:has-text("Highlight Reels")');
  if (await myReelsTab.count()) {
    await myReelsTab.first().click();
    await page.waitForTimeout(1000);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'criterion-5-published-my-reels');
  }
});
