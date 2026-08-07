import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5215 round 6 QA — user feedback from testing :5176 after round 5:
 *   1. The reel badge must clear immediately (no reload) when a reel that
 *      HAD an explicit intro is switched to "No intro" -- was a real bug:
 *      useDownloads.setIntroCard only updated the flat `downloads` array,
 *      never useCollections()'s separate `members` cache that most reel
 *      tiles actually render from.
 *   2. The small thumbnail the user saw on the collection header is the
 *      PRE-EXISTING, unrelated T5673 leading-reel-poster feature -- verified
 *      live via DOM inspection, not intro-related. Held off pending
 *      confirmation at the time; round 7 confirmed + removed it (see
 *      e2e/T5215-round7.qa.spec.js).
 *   3. A NEW media-slot corner badge for the collection's OWN intro
 *      attachment (distinct from the removed round-5 title-row badge),
 *      reusing GET /api/collections/intro/batch.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5215-round6.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /My Reels/i }).first().click();
  await expect(page.getByRole('heading', { name: /My Reels|Library/i }).first())
    .toBeVisible({ timeout: 15000 });
}

async function openGameGroup(page, matchText) {
  const headers = page.locator('.animate-slide-in-right').getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    const text = await headers.nth(i).textContent();
    if (text && text.includes(matchText)) {
      await headers.nth(i).click();
      await page.waitForTimeout(600);
      return true;
    }
  }
  return false;
}

async function openReelIntroPicker(page, tile) {
  await tile.hover();
  await tile.getByRole('button', { name: /More actions/i }).click();
  await page.getByRole('button', { name: 'Intro' }).click();
  const listbox = page.getByRole('listbox', { name: 'Intro card' });
  await expect(listbox).toBeVisible({ timeout: 10000 });
  return listbox;
}

test.describe('T5215 round 6 (real account)', () => {
  test('item 1: reel badge clears immediately (no reload) when switched to No intro', async ({ page }) => {
    await openDrawer(page);
    const opened = await openGameGroup(page, 'Legends');
    test.skip(!opened, 'no "at Legends Mar 28" group on this account');

    const tile = page.getByTestId('reel-card').filter({ hasText: 'Brilliant Dribble and Pass' }).first();
    const hasTile = await tile.isVisible().catch(() => false);
    test.skip(!hasTile, 'no "Brilliant Dribble and Pass" reel on this account');

    // SETUP: make sure this reel has an EXPLICIT card attached (not null,
    // not already-0) first, so the transition under test is the real one.
    const cardsResp = await page.request.get('/api/intro-cards');
    const { cards } = await cardsResp.json();
    test.skip(cards.length === 0, 'no intro cards exist');
    const targetCard = cards[0];

    let listbox = await openReelIntroPicker(page, tile);
    const cardOption = listbox.getByRole('option', {
      name: targetCard.is_default ? `${targetCard.name} (your default)` : targetCard.name,
    });
    await cardOption.click();
    let patchResp = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro$/.test(r.url()) && r.request().method() === 'PATCH',
      { timeout: 10000 },
    );
    await page.getByRole('button', { name: 'OK' }).click();
    await patchResp;
    await expect(listbox).toHaveCount(0);

    const badge = tile.getByTestId('intro-badge');
    await expect(badge, 'setup: badge must show once an explicit card is attached').toBeVisible({ timeout: 5000 });

    // THE REPRO: switch this SAME reel to "No intro".
    listbox = await openReelIntroPicker(page, tile);
    const noIntroOption = listbox.getByRole('option', { name: 'No intro' });
    await noIntroOption.click();
    await expect(listbox).toBeVisible(); // select-then-OK, still open

    patchResp = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro$/.test(r.url()) && r.request().method() === 'PATCH',
      { timeout: 10000 },
    );
    await page.getByRole('button', { name: 'OK' }).click();
    const resp = await patchResp;
    const body = await resp.json().catch(() => null);
    expect(body?.intro_card_name, 'server must resolve no name for explicit-none').toBeFalsy();
    await expect(listbox).toHaveCount(0);

    // Without reload -- badge must be gone NOW (this is the bug: the badge
    // used to survive because the collapsed-group member cache never saw
    // the write).
    await saveEvidence(page, 'T5215-round6-badge-clears-no-reload');
    await expect(tile.getByTestId('intro-badge'), 'the badge must clear immediately, no reload needed')
      .toHaveCount(0);
  });

  // item 2's original test asserted the T5673 leading-reel poster WAS
  // present (correctly identified live, not intro-related, left alone --
  // see this file's header comment). Round 7 (user, 2026-08-07): "i want
  // the intro badge on collections, i didn't want the frame thumbnail" --
  // the user confirmed the poster itself should go. It's removed entirely
  // now; the standing regression guard for the single remaining media-slot
  // path (Film icon + intro badge, no poster) lives in
  // e2e/T5215-round7.qa.spec.js.

  test('item 3: collection media-slot badge reflects the collection\'s own intro attachment', async ({ page }) => {
    await openDrawer(page);
    const opened = await openGameGroup(page, 'Legends');
    test.skip(!opened, 'no "at Legends Mar 28" group on this account');

    const header = page.locator('.animate-slide-in-right').getByText('Game Highlights').first();
    const visible = await header.isVisible().catch(() => false);
    test.skip(!visible, '"Game Highlights" card not present on this account');
    const cardRoot = header.locator('xpath=ancestor::div[contains(@class,"flex items-center gap-3")]').first();
    const mediaSlot = cardRoot.locator('> div').first();

    const kebab = cardRoot.getByRole('button', { name: 'More actions' });
    await kebab.click();
    const introItem = page.getByRole('button', { name: 'Intro' });
    test.skip(await introItem.count() === 0, '"Intro" item not present on this collection (UI drift)');
    await introItem.click();

    const listbox = page.getByRole('listbox', { name: 'Intro card' });
    await expect(listbox).toBeVisible({ timeout: 10000 });
    const cardsResp = await page.request.get('/api/intro-cards');
    const { cards } = await cardsResp.json();
    test.skip(cards.length === 0, 'no intro cards exist');
    const targetCard = cards[0];
    const option = listbox.getByRole('option', {
      name: targetCard.is_default ? `${targetCard.name} (your default)` : targetCard.name,
    });
    await option.click();
    await expect(listbox).toBeVisible(); // select-then-OK, still open

    const patchResp = page.waitForResponse(
      (r) => /\/api\/collections\/intro/.test(r.url()) && r.request().method() === 'PATCH',
      { timeout: 10000 },
    );
    await page.getByRole('button', { name: 'OK' }).click();
    await patchResp;
    await expect(listbox).toHaveCount(0);

    // Immediately, no reload.
    const badgeImmediate = mediaSlot.getByTestId('intro-badge');
    await expect(badgeImmediate, 'the media-slot badge must appear immediately after OK').toBeVisible({ timeout: 5000 });

    // Must NOT be back inline with the title (that surface was removed in round 5).
    const titleSvgCount = await header.locator('xpath=ancestor::h3').first().locator('svg').count();
    expect(titleSvgCount, 'the badge must live in the media slot, not inline with the title again').toBe(0);
    await saveEvidence(page, 'T5215-round6-collection-media-badge');

    // After reload.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /My Reels/i }).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /My Reels/i }).first().click();
    await expect(page.getByRole('heading', { name: /My Reels|Library/i }).first()).toBeVisible({ timeout: 15000 });
    const opened2 = await openGameGroup(page, 'Legends');
    expect(opened2).toBe(true);
    const headerAfter = page.locator('.animate-slide-in-right').getByText('Game Highlights').first();
    await expect(headerAfter).toBeVisible({ timeout: 10000 });
    const cardRootAfter = headerAfter.locator('xpath=ancestor::div[contains(@class,"flex items-center gap-3")]').first();
    const mediaSlotAfter = cardRootAfter.locator('> div').first();
    await expect(mediaSlotAfter.getByTestId('intro-badge'), 'the badge must still show after reload')
      .toBeVisible({ timeout: 10000 });
    await saveEvidence(page, 'T5215-round6-collection-media-badge-after-reload');
  });
});
