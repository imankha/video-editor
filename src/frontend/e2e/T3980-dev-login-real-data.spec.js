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
