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

test('T4070: annotation banner shows soccer-notation time', async ({ context, page }) => {
  await loginAsRealUser(context);
  await openGameInAnnotate(page, process.env.E2E_DEBUG_GAME || '5');

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
