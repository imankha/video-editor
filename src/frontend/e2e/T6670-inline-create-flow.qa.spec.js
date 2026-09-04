import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T6670 QA — inline "create a new Athlete Intro Card" from the reel picker.
 *
 * Drives the REAL app as imankh@gmail.com / profile 9fa7378c (dev-login, real
 * R2/Postgres data). Evidences the acceptance criteria that only manifest in the
 * running app (the unit suite already covers the state handoff in isolation):
 *
 *   AC1/AC2: reel kebab -> Intro picker -> "New card" opens the SAME editor
 *            without leaving the picker; finishing returns to the SAME picker.
 *   AC3:     the new card is VISIBLE in the carousel AND pre-selected on return.
 *   AC5:     OK fires EXACTLY ONE existing attach write (PATCH /downloads/{id}/
 *            intro) carrying the new card id -- no second/parallel write path.
 *   AC4:     a NO-CONSENT profile hitting "New card" meets the inline consent
 *            gate BEFORE any card is created (create is not silently bypassed);
 *            granting consent then proceeds to create + edit.
 *
 * The listbox aria-label is "Athlete Intro Card" (T6660 rename).
 *
 * Run: bash scripts/dev-verify.sh e2e/T6670-inline-create-flow.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const LISTBOX = 'Athlete Intro Card';
const NEW_CARD = 'Create new Athlete Intro Card';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /^Published/ }).first().click();
  await expect(page.getByTestId('published-tab-panel').first())
    .toBeVisible({ timeout: 15000 });
}

async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  const headers = page.getByTestId('published-tab-panel').getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
    const appeared = await page.getByTestId('reel-card').first()
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (appeared) return true;
  }
  return false;
}

async function openManageProfileEdit(page) {
  await page.getByRole('button', { name: /Switch sport or profile/i }).click();
  await expect(page.getByRole('heading', { name: 'Manage Profiles' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Edit name, color & sport' }).first().click();
  // T6660 renamed this section heading to "Athlete Intro Card"; wait on it so
  // the consent checkbox in ProfileIntroSection is mounted before we read it.
  await expect(page.getByRole('heading', { name: 'Athlete Intro Card' })).toBeVisible({ timeout: 10000 });
}

async function setConsent(page, want) {
  const checkbox = page.getByRole('checkbox');
  const checked = await checkbox.isChecked();
  if (checked === want) return;
  const resp = page.waitForResponse(
    (r) => /\/api\/profiles\/.+\/intro-consent/.test(r.url()) && r.request().method() !== 'GET',
    { timeout: 10000 },
  ).catch(() => null);
  await checkbox.click();
  await resp;
}

// Open the reel picker (kebab -> Intro) for the first reel; returns the reel
// tile locator (or skips if there are no reels / no Intro item).
async function openReelPicker(page) {
  const hasReels = await expandFirstGroup(page);
  test.skip(!hasReels, 'no published reels on this account/profile (drawer empty)');
  const tile = page.getByTestId('reel-card').first();
  await tile.hover();
  await tile.getByRole('button', { name: /More actions/i }).click();
  const introItem = page.getByRole('button', { name: 'Intro' });
  test.skip(await introItem.count() === 0, '"Intro" kebab item not present (UI drift)');
  await introItem.click();
  await expect(page.getByRole('listbox', { name: LISTBOX })).toBeVisible({ timeout: 10000 });
  return tile;
}

test.describe('T6670 inline create-and-return (real account)', () => {
  test('AC1-3,5: New card -> editor -> return with the new card VISIBLE + PRE-SELECTED; OK = one attach write', async ({ page }) => {
    // Ensure consent so the create succeeds (the no-consent path is AC4 below).
    await page.goto('/');
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await openManageProfileEdit(page);
    await setConsent(page, true);
    await page.keyboard.press('Escape');

    const before = await (await page.request.get('/api/intro-cards')).json();
    const beforeCount = before.cards.length;

    await openDrawer(page);
    await openReelPicker(page);
    await saveEvidence(page, 'T6670-AC1-picker-with-new-card-tile');

    // The "New card" affordance is present in the picker.
    const newCardTile = page.getByRole('button', { name: NEW_CARD });
    await expect(newCardTile).toBeVisible();

    // Click it -> the SAME editor mounts inline (create POST fires), the picker
    // never unmounts (AC1: no leaving the picker's context).
    const createResp = page.waitForResponse(
      (r) => /\/api\/intro-cards$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await newCardTile.click();
    const created = await (await createResp).json();
    expect(created.id, 'a new card row was created').toBeTruthy();
    // The generated name uses the T6660 "Athlete Intro Card" terminology.
    expect(created.name).toMatch(/^Athlete Intro Card \d+$/);

    // The editor is mounted (its card-name field), and the listbox is gone
    // (we're in the create view of the SAME modal, not a new one).
    await expect(page.getByLabel('Card name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'New Athlete Intro Card' })).toBeVisible();
    await saveEvidence(page, 'T6670-AC1-editor-mounted-inline');

    // Finish the edit -> back to the SAME picker (AC2).
    await page.getByRole('button', { name: 'Cards' }).click();
    const listbox = page.getByRole('listbox', { name: LISTBOX });
    await expect(listbox).toBeVisible({ timeout: 10000 });

    // AC3: the new card is VISIBLE in the carousel AND pre-selected.
    const newOption = listbox.getByRole('option', { name: created.name });
    await expect(newOption, 'the new card appears in the picker list').toBeVisible();
    await expect
      .poll(() => newOption.getAttribute('aria-selected'), {
        timeout: 5000,
        message: 'the new card must be pre-selected on return',
      })
      .toBe('true');
    await saveEvidence(page, 'T6670-AC3-new-card-visible-and-preselected');

    // AC5: OK fires EXACTLY ONE attach write, carrying the new card id.
    let writeCount = 0;
    page.on('response', (r) => {
      if (/\/api\/downloads\/\d+\/intro$/.test(r.url()) && r.request().method() === 'PATCH') writeCount++;
    });
    const patchResp = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro$/.test(r.url()) && r.request().method() === 'PATCH',
      { timeout: 10000 },
    );
    await page.getByRole('button', { name: 'OK' }).click();
    const patch = await patchResp;
    expect(patch.status(), 'the attach PATCH must succeed').toBeLessThan(300);
    const patchBody = await patch.json().catch(() => null);
    if (patchBody) expect(patchBody.intro_card_id).toBe(created.id);
    await expect(listbox).toHaveCount(0);
    await expect.poll(() => writeCount, { timeout: 5000 }).toBe(1);

    // Persistence round-trip: the new card really created (+1) and the reel now
    // carries it after a fresh reload.
    const after = await (await page.request.get('/api/intro-cards')).json();
    expect(after.cards.length, 'exactly one new card was created').toBe(beforeCount + 1);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /^Published/ }).first()).toBeVisible({ timeout: 20000 });
    const dl = await (await page.request.get('/api/downloads')).json();
    const reel = dl.downloads.find((d) => d.intro_card_id === created.id);
    expect(reel, 'a reel carries the new card id after reload').toBeTruthy();
    await saveEvidence(page, 'T6670-AC5-attach-persisted-after-reload');
  });

  test('AC4: a no-consent profile hitting "New card" meets the inline consent gate BEFORE any card is created', async ({ page }) => {
    // Revoke consent via the real UI so this exercises the true no-consent state.
    await page.goto('/');
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await openManageProfileEdit(page);
    await setConsent(page, false);
    await page.keyboard.press('Escape');

    const before = await (await page.request.get('/api/intro-cards')).json();
    const beforeCount = before.cards.length;

    await openDrawer(page);
    await openReelPicker(page);

    // Count create POSTs for the life of the test.
    let createCount = 0;
    page.on('response', (r) => {
      if (/\/api\/intro-cards$/.test(r.url()) && r.request().method() === 'POST') createCount++;
    });

    // Click "New card" -> the inline consent gate must appear, NOT the editor,
    // and NO card may be created (the gate is not bypassed by this new route).
    await page.getByRole('button', { name: NEW_CARD }).click();
    await expect(page.getByText('Consent required')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Card name')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(createCount, 'no card may be created before consent is recorded').toBe(0);
    const midway = await (await page.request.get('/api/intro-cards')).json();
    expect(midway.cards.length, 'card count unchanged while gated').toBe(beforeCount);
    await saveEvidence(page, 'T6670-AC4-consent-gate-before-create');

    // Grant consent via the gate's checkbox -> it proceeds to create + editor.
    const createResp = page.waitForResponse(
      (r) => /\/api\/intro-cards$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.getByRole('checkbox').click();
    await createResp;
    await expect(page.getByLabel('Card name')).toBeVisible({ timeout: 10000 });
    await saveEvidence(page, 'T6670-AC4-consent-granted-then-editor');

    // Leave the account with consent granted (good state for other runs).
  });

  test('responsive sweep: the picker with the New card tile at 375px + desktop', async ({ page }) => {
    await page.goto('/');
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await openManageProfileEdit(page);
    await setConsent(page, true);
    await page.keyboard.press('Escape');

    await openDrawer(page);
    await openReelPicker(page);
    await expect(page.getByRole('button', { name: NEW_CARD })).toBeVisible();
    await responsiveSweep(page, async () => {
      await assertNoHorizontalOverflow(page);
    });
  });
});
