import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

/**
 * T3980 — smoke: dev-login is a FAITHFUL impersonation. Logging in as a real
 * account (with a profile hint) must run the real session-init path (R2 download +
 * profile selection), so GET /api/games returns that account's REAL populated games
 * — not the 2 blank games the old X-User-ID header bypass produced.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T3980-dev-login-real-data.spec.js
 *
 * Requires the spec's user in this env's Postgres (seed with
 * scripts/copy_user_between_envs.py if dev-login 404s).
 */
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const H = { 'X-Profile-ID': PROFILE_ID };

test('T3980 dev-login yields the real account data (populated games)', async ({ context }) => {
  test.setTimeout(120000); // first R2 download of user.sqlite + profile.sqlite

  // Faithful login: email + profile hint -> real session-init runs at login time.
  const login = await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
  expect(login.user_id, 'dev-login returns the resolved user_id').toBeTruthy();
  // dev-login returns the RESOLVED profile: normally the hint, but session-init
  // falls back to the account's actual selected profile if the hint is stale.
  // The populated-games assertions below are the real faithfulness proof.
  expect(login.profile_id, 'dev-login returns a resolved profile_id').toBeTruthy();

  const res = await context.request.get('/api/games', { headers: H });
  expect(res.ok(), `GET /api/games (${res.status()})`).toBeTruthy();
  const body = await res.json();
  const games = body.games; // GET /api/games returns a {games: [...]} envelope

  expect(Array.isArray(games), 'games is a list').toBeTruthy();
  expect(games.length, 'real profile has games').toBeGreaterThan(0);

  // Faithfulness assertion: real games carry populated metadata, unlike the blank
  // (opponent_name/storage_status/recap all null) games the header bypass returned.
  const populated = games.filter(
    (g) => g.storage_status != null && g.opponent_name != null,
  );
  expect(
    populated.length,
    'at least one game has non-null storage_status + opponent_name (real data loaded)',
  ).toBeGreaterThan(0);

  // At least one game should have a recap video (imankh's profile has published recaps).
  const withRecap = games.filter((g) => g.recap_video_url != null);
  expect(withRecap.length, 'at least one game has a recap_video_url').toBeGreaterThan(0);
});

/**
 * T3980 acceptance criterion 2: the helper can DRIVE THE ACCOUNT'S ACTUAL
 * SCREENS — not just return API JSON. After loginAsRealUser, the real
 * Games-list screen must RENDER the account's real games (real opponent names),
 * and any expired game must render its expired-state UI.
 *
 * Data-driven: expected on-screen text is derived from GET /api/games so the
 * assertion tracks whatever real data this env's account currently holds.
 */
test('T3980 dev-login drives the real Games screen (real opponent names render)', async ({ context, page }) => {
  test.setTimeout(120000);

  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);

  // Source of truth for what SHOULD be on screen.
  const res = await context.request.get('/api/games', { headers: H });
  expect(res.ok(), `GET /api/games (${res.status()})`).toBeTruthy();
  const games = (await res.json()).games;
  expect(games.length, 'real profile has games').toBeGreaterThan(0);

  // Drive the actual UI: boot authenticates from the dev-login cookie, then open
  // the Games tab of the project manager.
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const gamesTab = page.locator('button:has-text("Games")');
  await expect(gamesTab, 'Games tab renders for the authenticated real account').toBeVisible({ timeout: 30000 });
  await gamesTab.click();

  // The rendered game cards carry the real opponent names (the old X-User-ID
  // header bypass produced blank, opponent-less games — this is the faithful
  // impersonation proof, on the SCREEN not just the API).
  const opponents = [...new Set(games.map((g) => g.opponent_name).filter(Boolean))];
  expect(opponents.length, 'real games carry opponent names').toBeGreaterThan(0);
  for (const opp of opponents.slice(0, 3)) {
    await expect(
      page.getByText(opp, { exact: false }).first(),
      `opponent "${opp}" is rendered on the Games screen`,
    ).toBeVisible({ timeout: 15000 });
  }

  // Expired-game state: assert the expired badge renders IF this account has an
  // expired game. This env's account currently has none (all active), so this
  // branch is data-dependent by design — the expired-render path itself is unit
  // covered by src/modes/AnnotateModeView.expired.test.jsx (bug 27p) and
  // RecapPlayerModal (recapVideoMissing).
  const expired = games.filter((g) => g.storage_status === 'expired');
  if (expired.length > 0) {
    await expect(
      page.getByText('Expired', { exact: true }).first(),
      'an expired game renders its Expired badge',
    ).toBeVisible({ timeout: 15000 });
  } else {
    console.log('[T3980] no expired game in this account — expired-badge assertion skipped (data-dependent)');
  }
});
