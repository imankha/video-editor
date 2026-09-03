import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T5675 — Home header/hero + games-card legibility QA.
 *
 * Real-browser evidence for the acceptance criteria at the four target widths
 * (360, 390x844, 768, 1315x748):
 *   (a) logo lockup renders as ONE unit (single-line "ReelBallers")
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

    // (a) Lockup is ONE intentional unit: a single-line "ReelBallers" element.
    const wordmark = page.getByText('ReelBallers', { exact: true }).first();
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

  // SURFACE CHANGED: the Games home used to list ProjectManager's GameCard, whose
  // GameMetaRow renders "Uploaded <date>", "Footage quality N/100" and the rating
  // chips. T5681's poster grid replaced that list with GameTile -- a compact tile
  // (as short as ~90px at the 2-up 390px breakpoint) whose scrim carries
  // name / match date / clip count (T7330). Asserting the old tokens here failed on a
  // surface that no longer renders them; GameCard itself is unchanged and still
  // covered by Vitest (ProjectManager.metaLegibility.test.jsx), so no coverage is
  // lost. What legibility means on THIS surface is asserted instead:
  const firstTile = page.locator('[data-game-id]').first();
  await expect(firstTile, 'a game tile renders').toBeVisible({ timeout: 15000 });
  const scrim = await firstTile.evaluate((el) => {
    const h3 = el.querySelector('h3');
    const spans = [...el.querySelectorAll('div > span')].map((s) => (s.textContent || '').trim());
    return { name: (h3?.textContent || '').trim(), spans };
  });
  expect(scrim.name, 'tile names the game').toBeTruthy();
  expect(
    // T8260: secondary line is "N annotations" optionally followed by " • M reels".
    scrim.spans.some((t) => /\d+\s+annotations?( • \d+ reels?)?$/.test(t)),
    `annotation count is labeled with its unit (got ${JSON.stringify(scrim.spans)})`,
  ).toBe(true);
  // T7330: the scrim carries the MATCH date again, with its weekday ("Sat, Mar 21") --
  // T7290 removed it as redundant with the title suffix, but the truncated title loses
  // its suffix first, so T7330 restored it. What legibility means here: the date is
  // present, weekday-labeled, and reads from game_date (the weekday prefix is what the
  // title suffix never has, so this can't be satisfied by the name leaking into a span
  // -- and `scrim.spans` is scoped to `div > span`, excluding the h3 anyway).
  expect(
    scrim.spans.some((t) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]{3}\s+\d{1,2}$/.test(t)),
    `match date renders with its weekday on the tile scrim (got ${JSON.stringify(scrim.spans)})`,
  ).toBe(true);

  await saveEvidence(page, 'criterion-3-gamecard-legibility');

  // Responsive sweep on Home (overflow + screenshots at the matrix widths).
  await responsiveSweep(page);
});
