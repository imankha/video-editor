/**
 * T4060 regression: annotations must render in the Annotate timeline when a saved
 * game is opened. The bug: T4000's early `/video` src made AnnotateScreen's mount
 * effect skip handleLoadGame (it bailed on `annotateVideoUrl`), so /load never ran
 * and no clip markers appeared.
 *
 * Doubles as the canonical example of driving the app AS A REAL USER with real data
 * (see e2e/helpers/realAuth.js + .claude/skills/drive-app-as-user/SKILL.md).
 *
 * Needs the dev backend (APP_ENV=dev) + a real account with annotated games. Run:
 *   cd src/frontend && npx playwright test e2e/annotate-annotations-render.spec.js
 * Params: E2E_REAL_EMAIL (default imankh@gmail.com), E2E_REAL_PROFILE,
 * E2E_DEBUG_GAME (explicit game id override; default: discover an ACTIVE game).
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';

// T7800: point API reads at E2E_API_BASE on a deployed target (CF Pages doesn't proxy /api).
const API_BASE = process.env.E2E_API_BASE || '/api';
const PROFILE = process.env.E2E_REAL_PROFILE;

test('annotations render in the Annotate timeline on game open (T4060)', async ({ context, page }) => {
  await loginAsRealUser(context, process.env.E2E_REAL_EMAIL || 'imankh@gmail.com', PROFILE);

  // T7800: discover an ACTIVE game (FIXTURE-CONTRACT §1) instead of the old hardcoded
  // game 5 — an expired/absent id hangs to the timeout instead of skipping (the exact
  // failure mode T5420 fixed in annotate-game-clock). E2E_DEBUG_GAME still overrides.
  let gameId = process.env.E2E_DEBUG_GAME;
  if (!gameId) {
    const res = await context.request.get(`${API_BASE}/games`, PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined);
    expect(res.ok(), `GET /api/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active');
    if (!target) {
      console.log('[T4060][SKIP] account has no ACTIVE game with annotations; seed one per FIXTURE-CONTRACT');
    }
    test.skip(!target, '[T7800] no active game available to open in Annotate');
    gameId = target.id;
  }
  await openGameInAnnotate(page, gameId);

  // Clip markers render once handleLoadGame -> /load -> importAnnotations completes.
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 20000 });
  const count = await page.locator('.clip-marker').count();
  expect(count).toBeGreaterThan(0);
  console.log(`[T4060] rendered ${count} clip markers for game ${gameId}`);
});
