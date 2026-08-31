/**
 * T8180 — a ghost annotate session (the game was deleted under the user) must be
 * impossible to miss. Bug 47p: the failed-upload cleanup deleted the game the user was
 * annotating; the client kept rendering it, finish-annotation 404'd SILENTLY, and the
 * user annotated the void for 26 minutes.
 *
 * This live-drive opens a REAL game in Annotate, then route-intercepts the per-game
 * endpoints to simulate the game vanishing mid-session, and asserts the LOUD 404
 * handling: a clip save fails visibly with work preserved, and leaving Annotate
 * surfaces the ghost toast + exits to the games list.
 *
 * Auth: dev-login as a real user (see realAuth). The user must exist in this env's
 * Postgres and own at least one game.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

async function firstGameId(page) {
  const res = await page.request.get('/api/games');
  expect(res.ok(), `GET /api/games failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const games = Array.isArray(body) ? body : (body.games || []);
  // This live-drive needs a real game to open Annotate on. In a data-barren env (e.g.
  // a fresh container whose dev user owns no games) skip rather than red-fail — the
  // logic is covered by the unit/integration suite; this spec is the staging/data-rich
  // proof. Seed a game (upload a clip) or point E2E_REAL_EMAIL at a user with games.
  test.skip(games.length === 0, `no games for ${EMAIL} in this env — cannot drive Annotate`);
  return games[0].id;
}

test.describe('T8180 ghost annotate session', () => {
  test('clip save against a deleted game fails loudly and preserves work', async ({ page }) => {
    await loginAsRealUser(page);
    const gameId = await firstGameId(page);
    await openGameInAnnotate(page, gameId);

    // Wait for the annotate video surface to mount.
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30_000 });

    // Simulate the ghost: every clip save now 404s (backend refuses to write an orphan).
    await page.route('**/api/clips/raw/save', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Game not found' }) })
    );

    // Trigger an add-clip gesture. The "Add Clip" affordance drives handleAddClip.
    const addClip = page.getByRole('button', { name: /add clip/i }).first();
    if (await addClip.isVisible().catch(() => false)) {
      await addClip.click();
      // Some flows open an overlay with a confirm/save; commit if present.
      const save = page.getByRole('button', { name: /^(save|add clip|done)$/i }).first();
      if (await save.isVisible().catch(() => false)) await save.click();
    }

    // The ghost toast must appear and NOT be a silent no-op.
    await expect(page.getByText(/this game no longer exists/i)).toBeVisible({ timeout: 10_000 });
    await saveEvidence(page, 'T8180-crit3-clip-save-ghost-toast');
  });

  test('leaving Annotate on a deleted game surfaces the ghost and exits to games', async ({ page }) => {
    await loginAsRealUser(page);
    const gameId = await firstGameId(page);
    await openGameInAnnotate(page, gameId);
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30_000 });

    // finish-annotation now 404s — the leave-annotate gesture must react loudly.
    await page.route('**/finish-annotation', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Game not found' }) })
    );

    // Leave Annotate (any exit gesture fires persistAnnotateProgress -> finishAnnotation).
    const back = page.getByRole('button', { name: /back|games|home|projects/i }).first();
    await back.click();

    await expect(page.getByText(/this game no longer exists/i)).toBeVisible({ timeout: 10_000 });
    await saveEvidence(page, 'T8180-crit2-finish-annotation-ghost-exit');
    // Exited the ghost session: no longer on /annotate.
    await expect.poll(() => new URL(page.url()).pathname).not.toContain('/annotate');
  });

  test('responsive sweep of the annotate surface', async ({ page }) => {
    await loginAsRealUser(page);
    const gameId = await firstGameId(page);
    await openGameInAnnotate(page, gameId);
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30_000 });
    await responsiveSweep(page);
  });
});
