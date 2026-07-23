import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T5675 — Home header/hero + games-card legibility QA.
 *
 * Real-browser evidence for the acceptance criteria at the four target widths
 * (360, 390x844, 768, 1315x748):
 *   (a) logo lockup renders as ONE unit (single-line "Reel Ballers")
 *   (b) draft/game list starts above the fold
 *   (c) GameCard metadata is labeled/tooltipped (no chess notation)
 *   (d) mobile continue strip is present
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T5675-home-hero-legibility.spec.js
 */
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const H = { 'X-Profile-ID': PROFILE_ID };
const API_BASE = process.env.E2E_API_BASE || '/api';

const WIDTHS = [
  { name: '360', width: 360, height: 800, fold: false },
  { name: '390x844', width: 390, height: 844, fold: true, mobile: true },
  { name: '768', width: 768, height: 1024, fold: false },
  { name: '1315x748', width: 1315, height: 748, fold: true },
];

async function gotoGamesHome(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const gamesTab = page.locator('button:has-text("Games")');
  await expect(gamesTab, 'Games tab renders for the authenticated account').toBeVisible({ timeout: 30000 });
  await gamesTab.click();
  await page.waitForTimeout(400); // let the list settle
}

test('T5675 home hero + GameCard legibility across widths', async ({ context, page }) => {
  test.setTimeout(180000); // first R2 download of user.sqlite + profile.sqlite

  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);

  // Source of truth for what should render.
  const res = await context.request.get(`${API_BASE}/games`, { headers: H });
  expect(res.ok(), `GET /api/games (${res.status()})`).toBeTruthy();
  const games = (await res.json()).games;
  expect(games.length, 'real profile has games').toBeGreaterThan(0);

  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await gotoGamesHome(page);

    // No horizontal overflow at any width.
    await assertNoHorizontalOverflow(page);

    // (a) Lockup is ONE intentional unit: a single-line "Reel Ballers" element.
    const wordmark = page.getByText('Reel Ballers', { exact: true }).first();
    await expect(wordmark, `lockup renders one-line wordmark @ ${vp.name}`).toBeVisible();
    const box = await wordmark.boundingBox();
    expect(box, `wordmark has a box @ ${vp.name}`).toBeTruthy();
    // One line: the wordmark never wraps into a two-line stack.
    expect(box.height, `wordmark is a single line @ ${vp.name} (h=${box.height})`).toBeLessThan(64);
    await saveEvidence(page, `criterion-1-lockup-${vp.name}`);

    // (b) List content above the fold at the two constrained heights.
    if (vp.fold) {
      const firstOpp = games.map((g) => g.opponent_name).filter(Boolean)[0];
      if (firstOpp) {
        const card = page.getByText(firstOpp, { exact: false }).first();
        await expect(card, `first game card visible @ ${vp.name}`).toBeVisible({ timeout: 15000 });
        const cb = await card.boundingBox();
        expect(cb.y, `list content starts above the fold @ ${vp.name} (y=${cb.y} < ${vp.height})`).toBeLessThan(vp.height);
      }
      await saveEvidence(page, `criterion-2-above-fold-${vp.name}`);
    }

    // (d) Mobile continue strip present.
    if (vp.mobile) {
      await expect(
        page.getByText('Continue Where You Left Off', { exact: false }).first(),
        'continue strip is shown on mobile',
      ).toBeVisible({ timeout: 15000 });
      await saveEvidence(page, `criterion-4-mobile-continue-${vp.name}`);
    }
  }

  // (c) GameCard legibility — assert on the desktop width where all tokens show.
  await page.setViewportSize({ width: 1315, height: 748 });
  await gotoGamesHome(page);

  // Chess-notation shorthand never reaches the UI.
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText, 'no chess "!!" notation on screen').not.toMatch(/\d!!/);
  expect(bodyText, 'no bare "Quality:" token').not.toMatch(/Quality:/);

  // Labeled tokens present.
  await expect(page.getByText(/Uploaded/).first(), 'date is labeled "Uploaded"').toBeVisible();

  // Rating chip legibility — data-dependent (assert only if a game has rated clips).
  const rated = games.find((g) => (g.brilliant_count || 0) > 0);
  if (rated) {
    const label = new RegExp(`${rated.brilliant_count} brilliant clips?`, 'i');
    await expect(
      page.getByLabel(label).first(),
      'brilliant rating chip carries an aria-label',
    ).toBeVisible({ timeout: 15000 });
  } else {
    console.log('[T5675] no game with brilliant clips in this account — rating-chip assertion skipped (data-dependent)');
  }

  const withClips = games.find((g) => (g.clip_count || 0) > 0);
  if (withClips) {
    await expect(
      page.getByText(/Footage quality \d+\/100/).first(),
      'quality score is labeled "Footage quality N/100"',
    ).toBeVisible({ timeout: 15000 });
  }

  await saveEvidence(page, 'criterion-3-gamecard-legibility');

  // Responsive sweep on Home (overflow + screenshots at the matrix widths).
  await responsiveSweep(page);
});
