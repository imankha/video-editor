import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { waitForAppReady } from './helpers/appReady.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8320 — Reel Drafts (Clips tab) surface the SOURCE game's storage expiry, the
 * way the Games tab already does on GameTile. A draft whose source is expired/
 * reclaimed shows a "Source expired" chip; one whose nearest source expiry is
 * under 14 days shows a countdown chip; a healthy source shows no chip.
 *
 * Real-browser proof (chromium): the chip is a pure render-time join
 * (deriveDraftSourceExpiry) that ProjectManager computes from the games list it
 * already holds and passes to DraftTile. jsdom unit tests pin the logic; this
 * spec proves it renders end-to-end in a real browser with the real CSS + the
 * real store wiring, and checks the three acceptance states side by side.
 *
 * Uses the new-user / empty-session bypass (test-login), then injects the games
 * + auto-draft projects directly into the Zustand stores — a reclaimed-source
 * draft cannot be produced through the live API in a fresh container (needs real
 * R2 + a sweep), so we seed the exact store shape ProjectsScreen feeds
 * ProjectManager. The components under test (ProjectManager join + DraftTile
 * chip) are the REAL ones.
 *
 * Run:
 *   cd src/frontend && E2E_AUTOSTART=1 npx playwright test e2e/T8320-drafts-source-expiry.qa.spec.js
 */

const TEST_USER_ID = `e2e8320_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9_]/gi, '');

function iso(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

// Three ready games: healthy (>14d), expiring soon (<14d), reclaimed (no row -> 'expired').
const GAMES = [
  { id: 9001, name: 'Healthy Source', status: 'ready', storage_status: 'active', storage_expires_at: iso(40), clip_count: 1 },
  { id: 9002, name: 'Expiring Soon', status: 'ready', storage_status: 'active', storage_expires_at: iso(6), clip_count: 1 },
  { id: 9003, name: 'Reclaimed Source', status: 'ready', storage_status: 'expired', storage_expires_at: null, clip_count: 1 },
];

// One single-clip auto-draft per game (is_auto_created routes it onto the Clips tab, T8360).
function draftFor(game, id) {
  return {
    id,
    name: `Draft of ${game.name}`,
    aspect_ratio: '9:16',
    clip_count: 1,
    clips_in_progress: 0,
    clips_exported: 0,
    has_working_video: false,
    has_final_video: false,
    is_published: false,
    is_auto_created: true,
    game_ids: [game.id],
    clips: [{ id: id * 10, tags: [] }],
  };
}
const PROJECTS = [draftFor(GAMES[0], 8001), draftFor(GAMES[1], 8002), draftFor(GAMES[2], 8003)];

skipOnDeployedTarget(test, 'imports /src/stores/*.js (Vite-dev seam) and needs the local stack');

test.describe('T8320 Reel Drafts source-expiry chip', () => {
  test('shows Source expired + countdown chips per draft, none for a healthy source', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });

    // Serve OUR data from every path that populates the games/projects stores
    // (bootstrap on load + any later refetch), so a delayed refetch can never
    // clobber the seeded state. The COMPONENTS under test (ProjectManager join +
    // DraftTile chip) are the real ones; only the data source is stubbed — a
    // reclaimed-source draft can't be produced through the live API here.
    await page.route((url) => url.pathname.endsWith('/api/bootstrap'), async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.projects = PROJECTS;
      json.games = { games: GAMES };
      await route.fulfill({ response: res, json });
    });
    await page.route((url) => url.pathname.endsWith('/api/games'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ games: GAMES }) });
    });
    await page.route((url) => url.pathname.endsWith('/api/projects'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROJECTS) });
    });

    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/auth/test-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
      });
    });
    await page.evaluate(async () => {
      const { useAuthStore } = await import('/src/stores/authStore.js');
      useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false, isCheckingSession: false });
    });

    // Land on the Clips tab (Reel Drafts).
    await page.goto('/home/reels');
    await waitForAppReady(page);

    // Three draft tiles render.
    await expect(page.locator('[data-testid="project-card"]')).toHaveCount(3, { timeout: 15000 });

    const chips = page.locator('[data-testid="source-expiry-chip"]');
    // Exactly TWO chips: the reclaimed (expired) + the <14d countdown. Healthy = none.
    await expect(chips).toHaveCount(2, { timeout: 15000 });
    const chipText = (await chips.allInnerTexts()).join(' | ');
    expect(chipText).toMatch(/Source expired/i);
    expect(chipText).toMatch(/6d/);

    await saveEvidence(page, 'T8320-criterion-all-three-states');

    // Criterion isolation via the chip -> owning tile (robust to the tile's
    // computed display name). Exactly one "Source expired" chip and one countdown
    // chip exist, each inside a distinct project-card.
    const expiredChip = chips.filter({ hasText: /Source expired/i });
    await expect(expiredChip).toHaveCount(1);
    await expect(expiredChip.locator('xpath=ancestor::*[@data-testid="project-card"]')).toHaveCount(1);
    await saveEvidence(page, 'T8320-criterion-reclaimed-expired-chip');

    const countdownChip = chips.filter({ hasText: /\d+d/ }).filter({ hasNotText: /Source expired/i });
    await expect(countdownChip).toHaveText(/^6d$/);
    await saveEvidence(page, 'T8320-criterion-countdown-chip');

    // Exactly one of the three tiles has NO chip (the healthy source).
    const tilesWithChip = page.locator('[data-testid="project-card"]:has([data-testid="source-expiry-chip"])');
    await expect(tilesWithChip).toHaveCount(2);
    await saveEvidence(page, 'T8320-criterion-healthy-no-chip');

    // No horizontal overflow introduced by the chip on the drafts surface.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
