/**
 * T4070: the annotation banner (NotesOverlay) shows the clip's in-match time in soccer
 * notation (MM'SS") during annotation playback. Drives the real app as a real user.
 *
 *   cd src/frontend && E2E_BASE_URL=http://localhost:5173 \
 *     npx playwright test e2e/annotate-game-clock.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';

const CLOCK = /\d{1,3}'\d{2}"/; // e.g. 34'12"
// T5420: point API reads at E2E_API_BASE on a deployed target (CF Pages doesn't proxy /api).
const API_BASE = process.env.E2E_API_BASE || '/api';
const PROFILE = process.env.E2E_REAL_PROFILE;

test('T4070: annotation banner shows soccer-notation time', async ({ context, page }) => {
  await loginAsRealUser(context, process.env.E2E_REAL_EMAIL || 'imankh@gmail.com', PROFILE);

  // Target an ACTIVE game (FIXTURE-CONTRACT §1): an EXPIRED game's card plays its recap
  // instead of loading Annotate and its "Playback Annotations" is DISABLED, so a hardcoded
  // id could land on one and hang the click. Discover an active game from /api/games; skip
  // LOUDLY if the account has none (never a silent pass) rather than hard-timeout (T5420 —
  // the old hardcoded game 5 was expired/unavailable on staging).
  const res = await context.request.get(`${API_BASE}/games`, PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined);
  expect(res.ok(), `GET /api/games (${res.status()})`).toBeTruthy();
  const games = (await res.json()).games || [];
  const target = games.find((g) => g.storage_status === 'active');
  if (!target) {
    console.log('[T4070][SKIP] account has no ACTIVE game to drive annotation playback; seed one per FIXTURE-CONTRACT');
  }
  test.skip(!target, '[T5420] no active game available for annotation playback');
  console.log(`[T4070] driving active game id=${target.id} (${target.opponent_name})`);
  await openGameInAnnotate(page, target.id);

  // Clips loaded (T4060) before we can play them back.
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 20000 });

  // Enter annotation playback.
  await page.getByText(/Playback Annotations/i).first().click();

  // The active-clip banner shows the in-match clock.
  const clock = page.getByText(CLOCK).first();
  await expect(clock).toBeVisible({ timeout: 20000 });
  const txt = await clock.textContent();
  // eslint-disable-next-line no-console
  console.log('[T4070] banner clock text:', txt);
  expect(txt).toMatch(CLOCK);
});
