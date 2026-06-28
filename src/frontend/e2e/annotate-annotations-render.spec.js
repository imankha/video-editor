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
 * Params: E2E_REAL_EMAIL (default imankh@gmail.com), E2E_DEBUG_GAME (default 5).
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';

test('annotations render in the Annotate timeline on game open (T4060)', async ({ context, page }) => {
  await loginAsRealUser(context);

  const gameId = process.env.E2E_DEBUG_GAME || '5';
  await openGameInAnnotate(page, gameId);

  // Clip markers render once handleLoadGame -> /load -> importAnnotations completes.
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 20000 });
  const count = await page.locator('.clip-marker').count();
  expect(count).toBeGreaterThan(0);
  // eslint-disable-next-line no-console
  console.log(`[T4060] rendered ${count} clip markers for game ${gameId}`);
});
