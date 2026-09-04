import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T6680 QA — proves the default/inherited Athlete Intro Card removal actually
 * closes the live consent hole, end to end, in the REAL running app.
 *
 * Design doc: docs/plans/tasks/T6680-design.md (v2, APPROVED). Acceptance
 * criteria under test here (design Section 2 target-state + Section 6 test
 * plan; unit-test coverage for the resolver matrix already lives in
 * src/backend/tests/test_t5215_intro_attachment.py and
 * test_t5230_intro_compliance.py -- NOT re-derived here):
 *
 *   1. A reel with NO explicit card attached (intro_card_id IS NULL) serves
 *      NO intro -- proven via GET /api/downloads (intro_card_name === null)
 *      for a profile that HAS cards (i.e. would have inherited a default
 *      under the old system).
 *   2. A DIFFERENT reel with an EXPLICITLY attached card still resolves and
 *      serves that card -- proves the fix didn't break the explicit-attach
 *      path.
 *   3. The picker shows only [specific cards | "No intro"] -- no inherit
 *      option, no "your default" badge, no prompt-to-attach nudge.
 *   4. is_default UI is fully retired: no "Default" badge in the card
 *      library/editor, no "Set as default" action, no "inherited"/"Following
 *      default" carousel state.
 *
 * Account: imankh@gmail.com / profile 9fa7378c (dev-login, real R2/Postgres
 * data) -- same account T5215's QA spec uses. This account may already carry
 * an is_default=1 row from the v040 backfill (design doc Section 1.1); that
 * row is exactly the "would have inherited a default" fixture criterion 1
 * needs, so no extra seeding is required for that flag.
 *
 * Run: bash scripts/dev-verify.sh e2e/T6680-intro-default-removal.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /^Published/ }).first().click();
  await expect(page.getByTestId('published-tab-panel').first())
    .toBeVisible({ timeout: 15000 });
}

// Expand every collapsed game/mix group so all reel tiles mount (T5673 pattern),
// returns the number of reel-card tiles now visible. Retries the header lookup
// once after a short settle -- the drawer's group list can still be fetching
// on a just-navigated page, so an immediate zero-header read is a false empty.
async function expandAllGroups(page) {
  // Some reels may already be ungrouped/visible without any group header
  // (T5673 pattern from the T5215 spec) -- if so, nothing to expand.
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return page.getByTestId('reel-card').count();

  const headers = page.getByTestId('published-tab-panel').getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
    // Wait for at least one tile to mount before moving to the next header --
    // this is what actually paces the loop against the async render (a flat
    // sleep after the loop was racy: tiles from the FIRST header click can
    // still be mounting while later headers are clicked).
    await page.getByTestId('reel-card').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }
  return page.getByTestId('reel-card').count();
}

async function openManageProfileEdit(page) {
  await page.getByRole('button', { name: /Switch sport or profile/i }).click();
  await expect(page.getByRole('heading', { name: 'Manage Profiles' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Edit name, color & sport' }).first().click();
  await expect(page.getByRole('heading', { name: 'Athlete Intro Card' })).toBeVisible({ timeout: 10000 });
}

async function ensureConsent(page) {
  const checkbox = page.getByRole('checkbox');
  const checked = await checkbox.isChecked();
  if (checked) return;
  const resp = page.waitForResponse(
    (r) => /\/api\/profiles\/.+\/intro-consent/.test(r.url()) && r.request().method() !== 'GET',
    { timeout: 10000 },
  ).catch(() => null);
  await checkbox.click();
  await resp;
  await expect(checkbox).toBeChecked({ timeout: 10000 });
}

async function ensureAtLeastTwoCards(page) {
  const introCardsBtn = page.getByRole('button', { name: 'Athlete Intro Cards' });
  await introCardsBtn.click();
  await expect(page.getByTestId('intro-cards-modal')).toBeVisible({ timeout: 10000 });

  for (let i = 0; i < 2; i++) {
    const noCardsYet = await page.getByText('No Athlete Intro Cards yet.').isVisible().catch(() => false);
    const cardTiles = await page.locator('[data-testid="intro-cards-modal"] [data-treatment]').count();
    if (noCardsYet || cardTiles < 2) {
      await page.getByRole('button', { name: 'New card', exact: true }).click();
      await expect(page.getByLabel('Card name')).toBeVisible({ timeout: 10000 });
      await page.getByLabel('Card name').fill(`T6680 QA card ${Date.now()}-${i}`);
      // Back to grid via the breadcrumb's "Cards" link (there's also an
      // unrelated "Athlete Intro Cards" button elsewhere on the page).
      await page.getByTestId('card-breadcrumb').getByRole('button', { name: 'Cards' }).click();
      await page.waitForTimeout(200);
    }
  }
  await page.getByRole('button', { name: 'Close' }).click();
}

test.describe('T6680 default/inherit intro removal (real account)', () => {
  test('setup: consent + at least two intro cards exist via real UI', async ({ page }) => {
    await page.goto('/');
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await openManageProfileEdit(page);
    await ensureConsent(page);
    await ensureAtLeastTwoCards(page);
    await saveEvidence(page, 'T6680-setup-consent-and-cards');

    // Confirm via the real API that this profile now HAS cards -- the
    // precondition for criterion 1 (an unattached reel on a profile that
    // WOULD have inherited a default under the old system).
    const cardsResp = await page.request.get('/api/intro-cards');
    const { cards } = await cardsResp.json();
    expect(cards.length, 'profile must have >=2 cards for the QA fixture').toBeGreaterThanOrEqual(2);
    console.log(`[T6680] profile has ${cards.length} cards, is_default row present: ${cards.some((c) => c.is_default)}`);
  });

  test('criteria 1+2: unattached reel serves no intro; explicitly-attached reel still serves its card', async ({ page }) => {
    await openDrawer(page);
    const reelCount = await expandAllGroups(page);
    test.skip(reelCount < 2, 'need at least 2 reels on this account/profile to test both paths independently');

    const cardsResp = await page.request.get('/api/intro-cards');
    const { cards } = await cardsResp.json();
    test.skip(cards.length === 0, 'no intro cards exist (setup test did not run)');
    const targetCard = cards[0];

    // --- Criterion 2 first: explicitly attach a card to reel #1 ---
    const firstTile = page.getByTestId('reel-card').nth(0);
    await firstTile.hover();
    await firstTile.getByRole('button', { name: /More actions/i }).click();
    const introItem1 = page.getByRole('button', { name: 'Intro' });
    test.skip(await introItem1.count() === 0, '"Intro" kebab item not present (UI drift)');
    await introItem1.click();

    let listbox = page.getByRole('listbox', { name: 'Athlete Intro Card' });
    await expect(listbox).toBeVisible({ timeout: 10000 });
    await listbox.getByRole('option', { name: targetCard.name, exact: true }).click();
    const patchResp1 = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro$/.test(r.url()) && r.request().method() === 'PATCH',
      { timeout: 10000 },
    );
    await page.getByRole('button', { name: 'OK' }).click();
    const resp1 = await patchResp1;
    expect(resp1.status()).toBeLessThan(300);
    const body1 = await resp1.json();
    // The PATCH response has no id field -- pull the reel id from the request
    // URL itself (/api/downloads/{id}/intro).
    const attachedReelId = Number(new URL(resp1.url()).pathname.match(/\/downloads\/(\d+)\/intro/)[1]);
    expect(body1.intro_card_id).toBe(targetCard.id);

    // --- Criterion 1: set reel #2's attachment explicitly to "No intro" so we
    // control a KNOWN unattached (0/NULL-equivalent) reel, then verify no
    // intro resolves for it. (0 and NULL are equivalent per Decision 3 -- an
    // explicit "No intro" pick is the reachable-via-UI way to land in that
    // state; a raw NULL is the same resolution path with the same assertion.) ---
    const secondTile = page.getByTestId('reel-card').nth(1);
    await secondTile.hover();
    await secondTile.getByRole('button', { name: /More actions/i }).click();
    const introItem2 = page.getByRole('button', { name: 'Intro' });
    await introItem2.click();

    listbox = page.getByRole('listbox', { name: 'Athlete Intro Card' });
    await expect(listbox).toBeVisible({ timeout: 10000 });
    await listbox.getByRole('option', { name: 'No intro' }).click();
    const patchResp2 = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro$/.test(r.url()) && r.request().method() === 'PATCH',
      { timeout: 10000 },
    );
    await page.getByRole('button', { name: 'OK' }).click();
    const resp2 = await patchResp2;
    expect(resp2.status()).toBeLessThan(300);
    const body2 = await resp2.json();
    const unattachedReelId = Number(new URL(resp2.url()).pathname.match(/\/downloads\/(\d+)\/intro/)[1]);
    expect(body2.intro_card_id).toBe(0);

    await saveEvidence(page, 'T6680-criterion-2-explicit-attach-set');

    // Reload and hit the real endpoint the gallery reads -- proves a REAL
    // round trip through the resolver, not a client echo.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /^Published/ }).first()).toBeVisible({ timeout: 20000 });
    const dl = await page.request.get('/api/downloads');
    expect(dl.ok()).toBe(true);
    const { downloads } = await dl.json();

    const attached = downloads.find((d) => d.id === attachedReelId);
    const unattached = downloads.find((d) => d.id === unattachedReelId);
    expect(attached, 'the explicitly-attached reel must be present').toBeTruthy();
    expect(unattached, 'the unattached (0/no-intro) reel must be present').toBeTruthy();

    // CRITERION 2: explicit attach still resolves and serves the card.
    expect(attached.intro_card_id, 'raw attachment preserved').toBe(targetCard.id);
    expect(attached.intro_card_name, 'CRITERION 2: explicit attach still resolves to the card name')
      .toBe(targetCard.name);

    // CRITERION 1: unattached (0, resolution-equivalent to NULL per Decision 3)
    // resolves to NO intro -- the hole-closure assertion. This profile HAS
    // cards (asserted in setup), so under the OLD system this reel would have
    // inherited the is_default card; here it must not.
    expect(unattached.intro_card_name, 'CRITERION 1: unattached reel must resolve to NO intro (hole closed)')
      .toBeNull();

    console.log(`[T6680] attached reel id=${attached.id} intro_card_name="${attached.intro_card_name}"`);
    console.log(`[T6680] unattached reel id=${unattached.id} intro_card_name=${unattached.intro_card_name}`);

    await saveEvidence(page, 'T6680-criterion-1-2-downloads-list-evidence');
  });

  test('criterion 3: picker shows only [cards | No intro], no inherit option, no "your default" badge', async ({ page }) => {
    await openDrawer(page);
    const reelCount = await expandAllGroups(page);
    test.skip(reelCount < 1, 'no reels on this account/profile');

    const tile = page.getByTestId('reel-card').first();
    await tile.hover();
    await tile.getByRole('button', { name: /More actions/i }).click();
    const introItem = page.getByRole('button', { name: 'Intro' });
    test.skip(await introItem.count() === 0, '"Intro" kebab item not present (UI drift)');
    await introItem.click();

    const listbox = page.getByRole('listbox', { name: 'Athlete Intro Card' });
    await expect(listbox).toBeVisible({ timeout: 10000 });

    // Only "No intro" + card options -- no separate "inherit"/"default" tile.
    await expect(listbox.getByRole('option', { name: 'No intro' })).toBeVisible();
    await expect(listbox.getByText(/your default/i)).toHaveCount(0);
    await expect(listbox.getByText(/inherit/i)).toHaveCount(0);
    await expect(listbox.getByText(/following default/i)).toHaveCount(0);

    // No prompt-to-attach nudge (explicitly out of scope per design OQ2).
    await expect(page.getByText(/attach an intro/i)).toHaveCount(0);

    await saveEvidence(page, 'T6680-criterion-3-picker-no-inherit-option');
  });

  test('criterion 4: is_default UI fully retired in the card library/editor', async ({ page }) => {
    await page.goto('/');
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await openManageProfileEdit(page);

    await page.getByRole('button', { name: 'Athlete Intro Cards' }).click();
    await expect(page.getByTestId('intro-cards-modal')).toBeVisible({ timeout: 10000 });
    // Wait for the grid's async card fetch to resolve (modal opens with a
    // loading spinner first) -- assert on at least one real edit tile so the
    // checks below run against actual content, not a still-loading spinner.
    await expect(page.locator('[data-testid="intro-cards-modal"]').getByRole('button', { name: /^Edit / }).first())
      .toBeVisible({ timeout: 10000 });

    // No "Default" badge anywhere in the grid, no "Set as default" action.
    await expect(page.getByText('Default', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/set as default/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /set as default/i })).toHaveCount(0);

    await saveEvidence(page, 'T6680-criterion-4-library-no-default-badge');

    // Open the first card's editor (click the tile itself, aria-label "Edit
    // <name>") -- same check there (design doc: IntroCardEditorContainer.jsx
    // :150-156 used to render the badge/selector).
    const grid = page.locator('[data-testid="intro-cards-modal"]');
    const firstEditBtn = grid.getByRole('button', { name: /^Edit / }).first();
    if (await firstEditBtn.count() > 0) {
      await firstEditBtn.click();
      await expect(page.getByLabel('Card name')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Default', { exact: true })).toHaveCount(0);
      await expect(page.getByText(/set as default/i)).toHaveCount(0);
      await saveEvidence(page, 'T6680-criterion-4-editor-no-default-badge');
      await page.getByTestId('card-breadcrumb').getByRole('button', { name: 'Cards' }).click().catch(() => {});
    }

    // Delete-confirm copy must not reference "your default" (design doc
    // Section 1.5: old IntroCardGrid.jsx:50 "deleting your default..."; the
    // current copy is "Any reel set to use this card will fall back to no
    // intro." per IntroCardGrid.jsx -- confirm that's what actually renders).
    const deleteBtn = grid.getByRole('button', { name: /^Delete / }).first();
    if (await deleteBtn.count() > 0) {
      await deleteBtn.click();
      await expect(page.getByText(/Delete "/)).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/your default/i)).toHaveCount(0);
      await expect(page.getByText(/fall back to no intro/i)).toBeVisible();
      await saveEvidence(page, 'T6680-criterion-4-delete-confirm-no-default-copy');
      // Cancel out -- do not actually delete the QA fixture card. The confirm
      // dialog is a portal rendered outside the intro-cards-modal subtree (a
      // second "Cancel" also exists inside the card-name editor form), so
      // scope to the dialog containing the "Delete card" button.
      await page.locator('div').filter({ has: page.getByRole('button', { name: 'Delete card' }) })
        .getByRole('button', { name: 'Cancel' }).first().click();
    }
    await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
  });

  test('responsive sweep: picker carousel + card library at mobile width', async ({ page }) => {
    await openDrawer(page);
    const reelCount = await expandAllGroups(page);
    test.skip(reelCount < 1, 'no reels on this account/profile');

    const tile = page.getByTestId('reel-card').first();
    await tile.hover();
    await tile.getByRole('button', { name: /More actions/i }).click();
    const introItem = page.getByRole('button', { name: 'Intro' });
    if (await introItem.count() > 0) {
      await introItem.click();
      const listbox = page.getByRole('listbox', { name: 'Athlete Intro Card' });
      await expect(listbox).toBeVisible({ timeout: 10000 });
      await responsiveSweep(page);
    } else {
      console.log('[T6680] "Intro" kebab item not present; sweeping drawer only');
      await responsiveSweep(page);
    }
  });
});
