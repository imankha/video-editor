import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

/**
 * Game Loading E2E Test
 *
 * Verifies that clicking a saved game transitions into Annotate mode (the historical
 * "blink" bug where the click didn't switch modes).
 *
 * T5320: logs in as the SEEDED real account (see e2e/FIXTURE-CONTRACT.md) and loads a
 * pre-existing game rather than uploading one. WHY the change: this spec used an empty
 * X-User-ID-isolated user and self-seeded a game by uploading a video + TSV — which on a
 * deployed target hangs (the upload/extract pipeline is slow/unavailable there) to the
 * per-test timeout. The fixture account is guaranteed >= 1 ACTIVE game with clips, so we
 * load that. If none is present we FAIL LOUDLY (the fixture is not seeded) rather than
 * silently self-seeding, which would hide a fixture violation (CLAUDE.md: no silent
 * fallback for internal data).
 *
 * NOTE (game state): an EXPIRED game's card click plays its recap / offers extend — it
 * does NOT load into Annotate (see ProjectManager GameCard.handleClick). So the spec
 * targets the first ACTIVE game by id, read from the API, not "the first card".
 */

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';

/**
 * Read the fixture account's games and return the first ACTIVE one (with clips).
 * Fails loudly if none — a fixture violation, not something to skip past.
 */
async function firstActiveGame(page) {
  const res = await page.request.get(`${API_BASE}/games`);
  expect(res.ok(), `GET /games must succeed (auth/fixture); got ${res.status()}`).toBe(true);
  const games = (await res.json()).games || [];
  const active = games.find((g) => g.storage_status !== 'expired' && g.clip_count > 0);
  expect(
    active,
    `seeded fixture account must have >= 1 ACTIVE game with clips (see e2e/FIXTURE-CONTRACT.md); ` +
      `got ${games.length} game(s): ${games.map((g) => `${g.id}:${g.storage_status}:${g.clip_count}c`).join(', ')}`,
  ).toBeTruthy();
  return active;
}

/** Open the Games tab. The caller then waits on the specific game card it wants, which
 *  is what actually settles the list (the tab renders a skeleton, not a text spinner). */
async function openGamesTab(page) {
  await page.locator('button:has-text("Games")').click();
}

/** Assert the app is in Annotate mode for a loaded game (URL + a real annotate marker). */
async function expectInAnnotateMode(page) {
  await expect(page).toHaveURL(/\/annotate/, { timeout: 15000 });
  // Reliable markers (T5320: the old `.text-green-400` badge selector is stale): the
  // <video> element and/or the clip markers rendered from the loaded game's clips.
  const video = page.locator('video').first();
  const clipMarker = page.locator('.clip-marker').first();
  await expect(video.or(clipMarker)).toBeVisible({ timeout: 15000 });
  // And NOT still on the project manager.
  await expect(page.locator('button:has-text("Add Game")')).toHaveCount(0);
}

test.describe('Game Loading', () => {
  test.beforeAll(async ({ request }) => {
    let lastError = null;
    for (let i = 0; i < 30; i++) {
      try {
        const health = await request.get(`${API_BASE}/health`);
        if (health.ok()) { lastError = null; break; }
      } catch (e) {
        lastError = e;
        if (i < 29) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (lastError) {
      throw new Error(`Backend not reachable at ${API_BASE}. Start the stack (see FIXTURE-CONTRACT.md).`);
    }
  });

  test('Load saved game into annotate mode', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);

    // Capture console/page errors (kept from the original debug intent).
    const consoleLogs = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (error) => {
      console.log(`PAGE ERROR: ${error.message}`);
      consoleLogs.push(`[error] ${error.message}`);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const game = await firstActiveGame(page);
    console.log(`Loading active fixture game ${game.id} ("${game.name}", ${game.clip_count} clips)`);

    await openGamesTab(page);
    await expect(page.locator(`[data-game-id="${game.id}"]`)).toBeVisible({ timeout: 15000 });

    consoleLogs.length = 0;
    await page.locator(`[data-game-id="${game.id}"]`).click();

    await expectInAnnotateMode(page);
  });

  test('editorMode state changes on game load', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);

    const modeChanges = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[EditorStore] setEditorMode')) {
        modeChanges.push(text);
        console.log(`MODE CHANGE: ${text}`);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const game = await firstActiveGame(page);
    await openGamesTab(page);
    await expect(page.locator(`[data-game-id="${game.id}"]`)).toBeVisible({ timeout: 15000 });

    await page.locator(`[data-game-id="${game.id}"]`).click();
    await expectInAnnotateMode(page);

    await page.screenshot({ path: 'test-results/game-load-debug.png', fullPage: true });
  });
});
