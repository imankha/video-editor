/**
 * T10120 — a fully-annotated team-only game must offer "Watch annotations" and
 * open the recap on the TEAM tab (bug 52 — sarkarati's LA Breakers game).
 *
 * Reproduces the exact bug shape via the dev-only `/api/test/seed-recap-game`
 * seam with athlete_clips=0, team_clips=2: the team recap stitches into R2 but
 * `games.recap_video_url` stays NULL (that column is athlete-layer-only, T5710),
 * so the OLD `hasRecap = Boolean(recap_video_url)` gate collapsed the tile to a
 * Delete-only dead end. The fix gates on clip_count instead and opens on the tab
 * that actually has content (athlete_clip_count === 0 -> team).
 *
 * Local gate member (seeds via a dev-only seam; skips loudly on a deployed target).
 */
import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const TEST_USER_ID = `e2e_t10120_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_HEADERS = { 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' };

async function authenticateTestUser(page) {
  await page.goto('/');
  const result = await page.evaluate(async (headers) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST', credentials: 'include', headers: { ...headers, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { error: `test-login failed: ${res.status}` };
    return res.json();
  }, TEST_HEADERS);
  if (result.error) throw new Error(`[T10120] ${result.error}`);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

// page.request shares the browser's rb_session cookie (see the T5710 isolation note).
async function seedTeamOnlyGame(apiRequest) {
  const res = await apiRequest.post(`${API_BASE}/test/seed-recap-game`, {
    headers: { 'X-Test-Mode': 'true', 'Content-Type': 'application/json' },
    data: { name: 'T10120 Team-Only Game', athlete_clips: 0, team_clips: 2 },
  });
  expect(res.ok(), `seed-recap-game failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  // The team layer must actually stitch (that's the recap that exists in R2).
  expect(body.stitched?.team?.status).toBe('stitched');
  return body;
}

async function cleanupTestUser(apiRequest) {
  try {
    await apiRequest.delete(`${API_BASE}/auth/user`, { headers: { 'X-Test-Mode': 'true' } });
  } catch { /* best-effort */ }
}

test.describe('T10120 team-only game — Watch annotations @gate-c', () => {
  skipOnDeployedTarget(test, 'seeds via the dev-only /api/test/seed-recap-game seam');

  test('offers Watch annotations and opens the recap on the Team tab', async ({ page }) => {
    test.setTimeout(120_000);
    await authenticateTestUser(page);
    const seed = await seedTeamOnlyGame(page.request);

    // Server-truth: the games-list payload carries the derived per-layer counts,
    // recap_video_url is NULL (the bug shape), and clip_count > 0.
    const listRes = await page.request.get(`${API_BASE}/games`);
    const listBody = await listRes.json();
    const games = Array.isArray(listBody) ? listBody : (listBody?.games ?? []);
    const g = games.find((x) => x.id === seed.game_id);
    expect(g, `seeded game ${seed.game_id} missing from list`).toBeTruthy();
    expect(g.recap_video_url == null).toBeTruthy();     // athlete-layer-only pointer -> NULL
    expect(g.clip_count).toBe(2);
    expect(g.athlete_clip_count).toBe(0);
    expect(g.team_clip_count).toBe(2);

    // The games store was hydrated at page load, before the seed -> reload so the
    // freshly-seeded game is in the list the tile grid renders from.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Real UI: open the tile's kebab and confirm "Watch annotations" is offered
    // (the old gate would have hidden it -> Delete-only dead end).
    await page.getByRole('button', { name: /^Games/ }).first().click();
    const tile = page.locator(`[data-game-id="${seed.game_id}"]`);
    await tile.waitFor({ timeout: 30000 });
    await tile.hover();
    await tile.locator('[data-game-kebab]').click();
    const watch = page.getByRole('button', { name: 'Watch annotations', exact: true });
    await expect(watch).toBeVisible();
    await saveEvidence(page, 'T10120-criterion1-2-watch-annotations-offered');

    // Clicking opens the recap modal on the TEAM tab (not the empty athlete tab).
    await watch.click();
    await page.locator('video').first().waitFor({ timeout: 30000 });
    // The team layer's clip name appears in the rail -> the team tab rendered content.
    await expect(page.getByText('Team clip 1').first()).toBeVisible({ timeout: 15000 });
    await saveEvidence(page, 'T10120-criterion2-team-tab-opened');

    await cleanupTestUser(page.request);
  });
});
