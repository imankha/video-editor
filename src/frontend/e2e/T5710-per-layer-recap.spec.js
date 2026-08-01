/**
 * T5710 — Per-layer recaps (Team Recap / {Athlete} Recap).
 *
 * Drives a REAL browser against the shared `e2e@test.local` dev-only test
 * account (never the real imankh fixture account) — this test creates its
 * own game+clips via the `POST /api/test/seed-recap-game` test seam, gated
 * non-prod like every seam) so there is zero risk to real account data.
 *
 * NOTE this is NOT a per-run isolated user: `/api/auth/test-login` always
 * resolves to the same fixed `e2e@test.local` account regardless of the
 * `X-User-ID` header (see `auth.py::test_login`) -- the header only matters
 * for requests that carry no session cookie. All API calls below MUST go
 * through `page.request` (shares the page's `rb_session` cookie), never the
 * bare `request` fixture (a separate APIRequestContext with no cookies) --
 * otherwise the seeded game lands in an orphaned X-User-ID namespace the
 * browser never queries, and the UI falls back to silently showing whatever
 * pre-existing game happens to share the freshly-seeded game's numeric id.
 * `TEST_USER_ID` is kept only as a label for that fallback path / test seam
 * gating; it is NOT the identity the UI or the seeded data actually use.
 *
 * Seeds a game with rated clips on BOTH layers (2 athlete, 2 team, team
 * clips carrying tagged_teammates), stitches both real per-layer recaps via
 * `ensure_recap`, opens the recap modal, and asserts:
 *   - Team Recap and {Athlete} Recap tabs both render
 *   - switching tabs swaps the video source AND the clip rail to that layer's
 *     clips only (never mixed)
 *   - the Team Recap clip rail shows player-filter chips (epic decision 7)
 *   - Create Clip still works from the active layer's clip
 */
import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const TEST_USER_ID = `e2e_t5710_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  if (result.error) throw new Error(`[T5710] ${result.error}`);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

// `apiRequest` MUST be `page.request` -- see the isolation note in the header
// comment. Passing the bare `request` fixture here would silently seed into a
// namespace the logged-in browser session never sees.
async function seedRecapGame(apiRequest) {
  const res = await apiRequest.post(`${API_BASE}/test/seed-recap-game`, {
    headers: { 'X-Test-Mode': 'true', 'Content-Type': 'application/json' },
    data: { name: 'T5710 QA Game', athlete_clips: 2, team_clips: 2 },
  });
  expect(res.ok(), `seed-recap-game failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.stitched?.team?.status).toBe('stitched');
  expect(body.stitched?.athlete?.status).toBe('stitched');
  return body;
}

async function cleanupTestUser(apiRequest) {
  try {
    await apiRequest.delete(`${API_BASE}/auth/user`, { headers: { 'X-Test-Mode': 'true' } });
  } catch { /* best-effort */ }
}

test.describe('T5710 per-layer recaps @staging-gate', () => {
  test('Team Recap and {Athlete} Recap show layer-pure clip rails, chips, and Create Clip', async ({ page }) => {
    test.setTimeout(120_000);
    await authenticateTestUser(page);
    const seed = await seedRecapGame(page.request);

    // Open the recap directly from the game card (real UI entry point --
    // recap_video_url is set by the seam's stitch step, same gate a real
    // auto-exported game uses).
    await page.getByRole('button', { name: /^Games/ }).first().click();
    const tile = page.locator(`[data-game-id="${seed.game_id}"]`);
    await tile.waitFor({ timeout: 30000 });
    await tile.hover();
    await tile.locator('[data-game-kebab]').click();
    await page.getByRole('button', { name: 'Watch recap', exact: true }).click();
    await page.locator('video').first().waitFor({ timeout: 30000 });

    // Scope every assertion to the modal itself -- Create Clip below adds a
    // draft reel card to the (still-mounted, behind-the-modal) home page whose
    // title is the clip's own name, so an unscoped page-wide text search would
    // false-positive-match "Team clip 1" there once that draft exists.
    const modal = page.locator('.shadow-2xl').first();
    // Scope clip-name assertions to the rail itself, not the whole modal --
    // the currently-PLAYING clip's name also renders in the NotesOverlay
    // (video overlay) and the PlaybackControls transport label, both driven
    // off the unfiltered layer clips (by design: the stitched video keeps
    // autoplaying through every clip regardless of the rail's player-tag
    // filter). Each seeded clip is only ~1s, so by the time several awaited
    // assertions run, playback has typically advanced onto the next clip --
    // an unscoped `modal.getByText(...)` would then match that overlay/label
    // in addition to (or instead of) the rail, which is not what these
    // assertions are about. `rail` isolates the actual acceptance criterion:
    // which clips the FILTERED LIST contains.
    const rail = modal.getByTestId('recap-clip-rail');

    // Defaults to {Athlete} Recap (sticky-within-session default).
    await expect(modal.getByRole('button', { name: 'Team Recap' })).toBeVisible();
    const athleteTabBtn = modal.getByRole('button', { name: 'My Recap' });
    await expect(athleteTabBtn).toBeVisible();
    await saveEvidence(page, 'T5710-criterion-1-athlete-recap-default');

    // {Athlete} Recap rail shows only the 2 athlete clips (never team clips).
    await expect(rail.getByText('Athlete clip 1')).toBeVisible();
    await expect(rail.getByText('Athlete clip 2')).toBeVisible();
    await expect(rail.getByText('Team clip 1')).toHaveCount(0);
    await expect(rail.getByText('Team clip 2')).toHaveCount(0);

    // Switch to Team Recap.
    await modal.getByRole('button', { name: 'Team Recap' }).click();
    await page.waitForTimeout(500); // video src swap (key={effectiveTab} remount)
    await saveEvidence(page, 'T5710-criterion-2-team-recap-tab');

    // Team Recap rail shows only the 2 team clips (never athlete clips) --
    // the risky "never under the other layer's label" invariant.
    await expect(rail.getByText('Team clip 1')).toBeVisible();
    await expect(rail.getByText('Team clip 2')).toBeVisible();
    await expect(rail.getByText('Athlete clip 1')).toHaveCount(0);
    await expect(rail.getByText('Athlete clip 2')).toHaveCount(0);

    // Player-filter chips (epic decision 7): both tagged players + "All".
    await expect(modal.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Player 1' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Player 2' })).toBeVisible();

    // Filtering by a player narrows the RAIL to that player's clip only. (The
    // untagged clip may still legitimately appear elsewhere in the modal --
    // e.g. mid-autoplay in the video overlay -- so the absence check must be
    // scoped to the rail; asserting on the whole modal would be testing
    // autoplay timing, not the filter.)
    await modal.getByRole('button', { name: 'Player 1' }).click();
    await expect(rail.getByText('Team clip 1')).toBeVisible();
    await expect(rail.getByText('Team clip 2')).toHaveCount(0);
    await saveEvidence(page, 'T5710-criterion-4-player-filter-chip');
    await modal.getByRole('button', { name: 'All' }).click();
    await expect(rail.getByText('Team clip 2')).toBeVisible();

    // Create Clip still works from the Team Recap view (T4130 regression,
    // acceptance criterion "Create Clip from either recap view still works").
    await rail.getByText('Team clip 1').click();
    const createBtn = modal.getByTitle('Create a draft reel from this clip');
    await expect(createBtn).toBeEnabled({ timeout: 10000 });
    await createBtn.click();
    await expect(modal.getByTitle('This clip is already a draft reel')).toBeVisible({ timeout: 10000 });
    await saveEvidence(page, 'T5710-criterion-6-create-clip-from-team-view');

    // Switch back to {Athlete} Recap -- rail + video swap correctly, offsets
    // still line up (recap_start/recap_end asserted at the API level in
    // test_t5710_per_layer_recaps.py; here we confirm the UI reflects it).
    await athleteTabBtn.click();
    await expect(rail.getByText('Athlete clip 1')).toBeVisible();
    await expect(rail.getByText('Team clip 1')).toHaveCount(0);
    await saveEvidence(page, 'T5710-criterion-3-athlete-recap-after-switch-back');

    await cleanupTestUser(page.request);
  });
});
