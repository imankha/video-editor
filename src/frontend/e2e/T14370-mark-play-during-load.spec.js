import { test, expect, devices } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';
import { deleteClip } from './helpers/annotateClips.js';

/**
 * T14370: Mark play while the game's /load is still in flight.
 *
 * Reproduced on staging with the exact prod symptom: the Mark play card is on
 * screen seconds before /load returns (5-6s on a phone). A tap in that window
 * used to create nothing (no duration yet) or a play with no game id that then
 * crashed the editor when /load landed. Now the card is disabled until /load
 * resolves, and the first tap after that saves.
 *
 * Runs against a REAL account (dev-login) on a phone viewport. /load is held
 * back and stripped of plays so any game works as a zero-play game; the one
 * play this test creates is deleted in finally.
 *
 * Env: E2E_REAL_EMAIL, E2E_PROFILE_ID, E2E_GAME_ID (a single-video game that
 * is not expired). Staging: E2E_BASE_URL=https://reel-ballers-staging.pages.dev
 * E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api E2E_REAL_EMAIL=e2e@test.local
 * E2E_PROFILE_ID=4345b661 E2E_GAME_ID=6
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const LOAD_DELAY_MS = 6000;

const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];
test.use({ ...pixel7 });

test.describe('T14370 - Mark play during /load', () => {
  test('card is disabled until /load lands, then the first tap saves (no crash)', async ({ context, page }) => {
    test.setTimeout(180_000);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);

    let loadResolvedAt = null;
    await page.route(new RegExp(`/api/games/${GAME_ID}/load`), async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.game.annotations = [];
      await new Promise((r) => setTimeout(r, LOAD_DELAY_MS));
      loadResolvedAt = Date.now();
      await route.fulfill({ response: res, json: body });
    });

    let rawClipId = null;
    try {
      await openGameInAnnotate(page, GAME_ID);
      const card = page.getByTestId('annotate-mark-play-button');
      await card.waitFor({ timeout: 60000 });

      // The window the prod user hit: card on screen, /load still in flight.
      expect(loadResolvedAt).toBeNull();
      await expect(card).toBeDisabled();

      // Playwright's click waits for the card to become enabled, which happens
      // exactly when /load lands.
      const saved = page.waitForResponse(
        (r) => /\/clips\/raw\/save/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 60000 },
      );
      await card.click({ timeout: 60000 });
      expect(loadResolvedAt).not.toBeNull();

      const res = await saved;
      expect(res.status()).toBe(200);
      rawClipId = (await res.json()).raw_clip_id;
      expect(rawClipId).toBeTruthy();
      await page.getByTestId('play-editor-done').waitFor({ timeout: 20000 });
      expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    } finally {
      await deleteClip(context, rawClipId);
    }
  });
});
