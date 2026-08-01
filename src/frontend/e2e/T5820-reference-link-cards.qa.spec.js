import { test, expect } from '@playwright/test';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5820 QA — cross-profile game REFERENCE link cards on the Games tab, in a REAL
 * browser at 375px and 1280px.
 *
 * What is REAL here vs stubbed:
 *  - REAL (Chromium): the ReferenceGameCard render, the click gesture, the
 *    sessionStorage breadcrumb, `profileStore.switchProfile` (header reinstall +
 *    `_resetDataStores` + navigate), the ProjectManager consume-effect, the
 *    scroll-into-view + highlight ring, and the degraded-link notice. This is the
 *    click/navigation surface that jsdom gives false confidence on
 *    (feedback_real_browser_for_pointer_fixes) — so it runs for real.
 *  - STUBBED (network only): which reference/real rows each profile's `/api/games`
 *    returns, and the two-profile `/api/profiles` list. The backend MATERIALIZATION
 *    of a reference row (T5800 `ensure_game_reference` + T5810 move remap) is proven
 *    by the backend suite (test_t5800_game_reference.py / test_t5810_move_attribution.py)
 *    and needs the full upload->annotate->export->publish->move pipeline to produce;
 *    the seed seams cannot attribute `game_ids`, so — exactly as T5880 does for the
 *    grouping UI — the rows are injected so the REAL component tree renders them.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5820-reference-link-cards.qa.spec.js
 */

const HASH_A = 'a'.repeat(64); // frozen hash of the game owned by profile A (Kid)
const HASH_B = 'b'.repeat(64); // frozen hash of the game owned by profile B (Default)
const PROF_A = 'aaaaaaaa';
const PROF_B = 'bbbbbbbb';

// Real game (id 101) + a reference back to B's game (id 102).
const realGameA = {
  id: 101, name: 'Vs Alpha Jul 1', created_at: '2026-07-01T12:00:00Z',
  blake3_hash: HASH_A, status: 'ready', is_reference: false,
  source_profile_id: null, source_profile_name: null,
  clip_count: 2, storage_status: 'active', can_extend: true,
  recap_video_url: null, tag_badges: {},
};
const refInA_toB = {
  id: 102, name: 'Vs Bravo Jul 2', created_at: '2026-07-02T12:00:00Z',
  blake3_hash: HASH_B, status: 'ready', is_reference: true,
  source_profile_id: PROF_B, source_game_id: 201, source_profile_name: 'Default',
  clip_count: 0, storage_status: null, storage_expires_at: null, can_extend: false,
  recap_video_url: null, tag_badges: {},
};
// Real game (id 201) + a reference back to A's game (id 202).
const realGameB = {
  id: 201, name: 'Vs Bravo Jul 2', created_at: '2026-07-02T12:00:00Z',
  blake3_hash: HASH_B, status: 'ready', is_reference: false,
  source_profile_id: null, source_profile_name: null,
  clip_count: 3, storage_status: 'active', can_extend: true,
  recap_video_url: null, tag_badges: {},
};
const refInB_toA = {
  id: 202, name: 'Vs Alpha Jul 1', created_at: '2026-07-01T12:00:00Z',
  blake3_hash: HASH_A, status: 'ready', is_reference: true,
  source_profile_id: PROF_A, source_game_id: 101, source_profile_name: 'Kid',
  clip_count: 0, storage_status: null, storage_expires_at: null, can_extend: false,
  recap_video_url: null, tag_badges: {},
};

// Multi-video owning game (null blake3_hash — hash matching couldn't locate this
// before T5800 projected source_game_id) + a reference pointing at it from A.
const realGameB_multiVideo = {
  id: 301, name: 'Vs Charlie Jul 3', created_at: '2026-07-03T12:00:00Z',
  blake3_hash: null, status: 'ready', is_reference: false,
  source_profile_id: null, source_profile_name: null,
  clip_count: 5, storage_status: 'active', can_extend: true,
  recap_video_url: null, tag_badges: {},
};
const refInA_toB_multiVideo = {
  id: 302, name: 'Vs Charlie Jul 3', created_at: '2026-07-03T12:00:00Z',
  blake3_hash: null, status: 'ready', is_reference: true,
  source_profile_id: PROF_B, source_game_id: 301, source_profile_name: 'Default',
  clip_count: 0, storage_status: null, storage_expires_at: null, can_extend: false,
  recap_video_url: null, tag_badges: {},
};

/**
 * Install the two-profile stub harness. `gamesByProfile` maps a profile id to its
 * `/api/games` rows. Returns the recorded poster-request game ids (to prove
 * reference cards add no per-card network calls).
 */
async function installStubs(page, { gamesByProfile, initialProfile }) {
  const state = { current: initialProfile, posterRequests: [] };

  // Force App.jsx bootstrap into its per-store fallback fetches (aborting makes
  // apiFetch throw -> the catch runs fetchProfiles()/fetchGames(), which we stub).
  await page.route('**/api/bootstrap', (route) => route.abort());

  await page.route('**/api/profiles', (route) => {
    const profiles = [
      { id: PROF_A, name: 'Kid', color: '#10B981', isCurrent: state.current === PROF_A },
      { id: PROF_B, name: 'Default', color: '#3B82F6', isCurrent: state.current === PROF_B },
    ];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profiles }) });
  });

  await page.route('**/api/profiles/current', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.profileId) state.current = body.profileId;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
  });

  await page.route('**/api/games', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const games = gamesByProfile[state.current] || [];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ games }) });
  });

  // Record + short-circuit poster requests so we can assert reference cards make none.
  await page.route('**/api/games/*/poster.jpg', (route) => {
    const m = route.request().url().match(/games\/(\d+)\/poster\.jpg/);
    if (m) state.posterRequests.push(Number(m[1]));
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' });
  });

  return state;
}

const TEST_USER_ID = () => `e2e_t5820_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let lastUserId = null;

async function authAndGoto(page, userId) {
  lastUserId = userId;
  await page.setExtraHTTPHeaders({ 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.goto('/');
  await page.evaluate(async (headers) => {
    await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
  }, { 'Content-Type': 'application/json', 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 't5820@e2e.local', showAuthModal: false });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  // Land on the Games tab (projects are empty -> default).
  await expect(page.getByRole('heading', { name: 'Your Games' })).toBeVisible({ timeout: 15000 });
}

test.describe('T5820 reference game link cards', () => {
  skipOnDeployedTarget(test, 'import()s /src/stores for an empty test-login session + stubbed /api/games (Vite-dev path)');

  test.afterEach(async ({ request }) => {
    if (!lastUserId) return;
    try { await request.delete('/api/auth/user', { headers: { 'X-User-ID': lastUserId } }); } catch { /* best-effort */ }
    lastUserId = null;
  });

  test('criterion 1+5: reference renders as a link card (owner badge, no expiry/edit/annotate) — mobile + desktop', async ({ page }) => {
    await installStubs(page, {
      gamesByProfile: { [PROF_A]: [realGameA, refInA_toB], [PROF_B]: [realGameB, refInB_toA] },
      initialProfile: PROF_B,
    });
    await authAndGoto(page, TEST_USER_ID());

    // The reference card (on B, pointing at A) shows the owner badge + link glyph.
    const refCard = page.locator('[data-reference-card]');
    await expect(refCard).toHaveCount(1);
    await expect(refCard.getByText('In Kid')).toBeVisible();
    // No real-tile affordances on the reference card.
    await expect(refCard.getByTitle('More actions')).toHaveCount(0);
    // The real game beside it keeps its kebab (unchanged tile).
    await expect(page.getByTitle('More actions')).toHaveCount(1);
    await saveEvidence(page, 'criterion-1-reference-link-card');

    // criterion 5: responsive sweep on the Games tab (375 + 1280, no overflow).
    await responsiveSweep(page);
  });

  test('criterion 2: click navigates to the owning game — BOTH directions (default<->kid)', async ({ page }) => {
    const state = await installStubs(page, {
      gamesByProfile: { [PROF_A]: [realGameA, refInA_toB], [PROF_B]: [realGameB, refInB_toA] },
      initialProfile: PROF_B,
    });
    await authAndGoto(page, TEST_USER_ID());

    // --- Direction 1: on Default (B), click the "In Kid" reference -> land on A ---
    await page.locator('[data-reference-card]').click();
    // The switch lands on Kid's real game, highlighted (green ring on its wrapper).
    const alphaWrap = page.locator('[data-game-id="101"]');
    await expect(alphaWrap).toBeVisible({ timeout: 10000 });
    await expect(alphaWrap.getByRole('heading', { name: 'Vs Alpha Jul 1' })).toBeVisible();
    // Highlight ring is transient (~2.5s) — assert it within that window.
    await expect(alphaWrap).toHaveClass(/ring-green-400/, { timeout: 2000 });
    expect(state.current, 'switched to the owning profile A').toBe(PROF_A);
    await saveEvidence(page, 'criterion-2-landed-on-kid-highlighted');

    // --- Direction 2: on Kid (A), click the "In Default" reference -> land on B ---
    await page.locator('[data-reference-card]').click();
    const bravoWrap = page.locator('[data-game-id="201"]');
    await expect(bravoWrap).toBeVisible({ timeout: 10000 });
    await expect(bravoWrap.getByRole('heading', { name: 'Vs Bravo Jul 2' })).toBeVisible();
    await expect(bravoWrap).toHaveClass(/ring-green-400/, { timeout: 2000 });
    expect(state.current, 'switched back to the owning profile B').toBe(PROF_B);
    await saveEvidence(page, 'criterion-2-landed-on-default-highlighted');

    // No reference card ever triggered a per-card poster fetch (refs 102/202).
    expect(state.posterRequests, 'reference cards make no per-card network calls')
      .not.toEqual(expect.arrayContaining([102, 202]));
  });

  test('criterion 2b: click navigates + highlights a MULTI-VIDEO owning game (null blake3_hash)', async ({ page }) => {
    // Regression coverage for the id-based match (T5820 follow-up): a multi-video
    // owning game has a NULL blake3_hash, so it can only be located via source_game_id.
    const state = await installStubs(page, {
      gamesByProfile: {
        [PROF_A]: [realGameA, refInA_toB_multiVideo],
        [PROF_B]: [realGameB_multiVideo, refInB_toA],
      },
      initialProfile: PROF_A,
    });
    await authAndGoto(page, TEST_USER_ID());

    await page.locator('[data-reference-card]').click();
    const charlieWrap = page.locator('[data-game-id="301"]');
    await expect(charlieWrap).toBeVisible({ timeout: 10000 });
    await expect(charlieWrap.getByRole('heading', { name: 'Vs Charlie Jul 3' })).toBeVisible();
    await expect(charlieWrap).toHaveClass(/ring-green-400/, { timeout: 2000 });
    expect(state.current, 'switched to the owning profile B').toBe(PROF_B);
    await expect(page.locator('[data-reference-notice]')).toHaveCount(0);
    await saveEvidence(page, 'criterion-2b-multi-video-highlighted');
  });

  test('criterion 3: owning game deleted -> visible notice, no crash, no silent no-op', async ({ page }) => {
    // Profile A no longer has the real game (deleted after the move) — only its own
    // reference back to B. Clicking B's "In Kid" reference must surface a notice.
    const state = await installStubs(page, {
      gamesByProfile: { [PROF_A]: [refInA_toB], [PROF_B]: [realGameB, refInB_toA] },
      initialProfile: PROF_B,
    });
    await authAndGoto(page, TEST_USER_ID());

    await page.locator('[data-reference-card]').click();
    const notice = page.locator('[data-reference-notice]');
    await expect(notice).toBeVisible({ timeout: 10000 });
    await expect(notice).toContainText('no longer in Kid');
    expect(state.current, 'still navigated to the owning profile').toBe(PROF_A);
    await saveEvidence(page, 'criterion-3-degraded-link-notice');
  });

  test('criterion 4 + perf: real games render unchanged; warm Games-tab navigation < 3s', async ({ page }) => {
    await installStubs(page, {
      gamesByProfile: { [PROF_A]: [realGameA, refInA_toB], [PROF_B]: [realGameB, refInB_toA] },
      initialProfile: PROF_B,
    });
    await authAndGoto(page, TEST_USER_ID()); // warm the app (cold Vite compile excluded from the budget)

    // A real game keeps its full tile: name on the scrim + a working kebab menu.
    const realTile = page.locator('[data-game-id="201"]');
    await expect(realTile.getByRole('heading', { name: 'Vs Bravo Jul 2' })).toBeVisible();
    await realTile.getByTitle('More actions').click();
    await expect(page.getByText('Edit game')).toBeVisible();
    await expect(page.getByText('Delete game')).toBeVisible();
    await page.keyboard.press('Escape');
    await saveEvidence(page, 'criterion-4-real-tile-unchanged');

    // Perf: the interactive path this task adds is the cross-profile switch render
    // (warm app). Time click -> owning game's grid interactive.
    const t0 = Date.now();
    await page.locator('[data-reference-card]').click();
    await expect(page.locator('[data-game-id="101"]').getByRole('heading', { name: 'Vs Alpha Jul 1' })).toBeVisible();
    const interactiveMs = Date.now() - t0;
    console.log(`[T5820][perf] warm Games-tab navigation interactive in ${interactiveMs}ms`);
    expect(interactiveMs, 'warm Games-tab navigation interactive < 3s on the local stack').toBeLessThan(3000);
  });
});
