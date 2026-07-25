import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { waitForAppReady } from './helpers/appReady.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5677 — Home tab deep-links + unknown-route fallback (LIVE, real user).
 *
 * Drives the app AS THE REAL USER (imankh@gmail.com, prod-copied into dev) so the
 * projects list is non-empty — the ONLY condition under which the original bug
 * manifests: cold-loading /home/games bounced to /home/reels because a mount
 * effect flipped the tab to "projects" as soon as projects finished loading.
 *
 * Acceptance-criterion map (task doc T5677):
 *   AC1 cold /home/games shows Games; cold /home/reels shows Reel Drafts -> test 1, test 2
 *   AC2 refresh + back/forward preserve the visible tab                  -> test 3
 *   AC3 unknown route (/gallery) lands on /home                          -> test 4
 *   AC4 editor route (/framing) with no loaded project lands home        -> test 5
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T5677-home-deeplinks-route-fallback.spec.js --reporter=line
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = '9fa7378c';

const gamesTab = (page) => page.getByRole('button', { name: /^Games\b/ });
const draftsTab = (page) => page.getByRole('button', { name: /^Reel Drafts\b/ });

// The active tab carries `text-white` (colored pill); the inactive one is
// `text-gray-400`. Asserting BOTH pins which tab is showing unambiguously.
async function expectActiveTab(page, which) {
  const active = which === 'games' ? gamesTab(page) : draftsTab(page);
  const inactive = which === 'games' ? draftsTab(page) : gamesTab(page);
  await expect(active).toHaveClass(/text-white/);
  await expect(inactive).toHaveClass(/text-gray-400/);
}

// Wait until the ProjectManager has both tabs mounted AND the projects list has
// loaded (Reel Drafts count chip present), then give the mount effect a beat to
// run — that effect is exactly what used to bounce the tab, so the tab must NOT
// have moved after it fires.
async function waitForTabsSettled(page) {
  await waitForAppReady(page, { ready: gamesTab(page) });
  await expect(draftsTab(page)).toBeVisible();
  // The count chip on Reel Drafts only renders once projects.length > 0.
  await expect(draftsTab(page).locator('span', { hasText: /^\d+$/ })).toBeVisible();
  await page.waitForTimeout(750); // let the projects-count mount effect run
}

test.beforeEach(async ({ context }) => {
  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
});

test('AC1: cold-load /home/games shows the Games tab (no bounce to Reel Drafts)', async ({ page }) => {
  await page.goto('/home/games');
  await waitForTabsSettled(page);

  await expect(page).toHaveURL(/\/home\/games$/);
  await expectActiveTab(page, 'games');
  await saveEvidence(page, 'criterion-1-home-games-shows-games-tab');
});

test('AC1: cold-load /home/reels shows the Reel Drafts tab', async ({ page }) => {
  await page.goto('/home/reels');
  await waitForTabsSettled(page);

  await expect(page).toHaveURL(/\/home\/reels$/);
  await expectActiveTab(page, 'projects');
  await saveEvidence(page, 'criterion-1-home-reels-shows-drafts-tab');
});

test('AC2: refresh + back/forward preserve the visible tab', async ({ page }) => {
  // Land on Games, then refresh — the tab must survive the reload (URL is state).
  await page.goto('/home/games');
  await waitForTabsSettled(page);
  await expectActiveTab(page, 'games');

  await page.reload();
  await waitForTabsSettled(page);
  await expect(page).toHaveURL(/\/home\/games$/);
  await expectActiveTab(page, 'games');
  await saveEvidence(page, 'criterion-2-refresh-preserves-games');

  // Navigate to reels, then walk history back/forward across the two deep links.
  await page.goto('/home/reels');
  await waitForTabsSettled(page);
  await expectActiveTab(page, 'projects');

  await page.goBack();
  await waitForTabsSettled(page);
  await expect(page).toHaveURL(/\/home\/games$/);
  await expectActiveTab(page, 'games');
  await saveEvidence(page, 'criterion-2-back-restores-games');

  await page.goForward();
  await waitForTabsSettled(page);
  await expect(page).toHaveURL(/\/home\/reels$/);
  await expectActiveTab(page, 'projects');
  await saveEvidence(page, 'criterion-2-forward-restores-reels');
});

test('AC3: unknown route (/gallery) lands on /home, not inside an editor', async ({ page }) => {
  await page.goto('/gallery');
  await waitForAppReady(page, { ready: gamesTab(page) });

  // Canonicalized to a /home path — NEVER /framing/overlay/annotate/gallery.
  await expect(page).toHaveURL(/\/home(\/(games|reels))?$/);
  // The home tab bar is present (proof we rendered ProjectManager, not an editor).
  await waitForTabsSettled(page);
  await expect(gamesTab(page)).toBeVisible();
  await expect(draftsTab(page)).toBeVisible();
  await saveEvidence(page, 'criterion-3-gallery-lands-home');
});

test('AC4: cold /framing with no loaded project redirects home', async ({ page }) => {
  await page.goto('/framing');
  await waitForAppReady(page, { ready: gamesTab(page) });

  // No project was selected on this cold hit, so the editor route must redirect
  // to home rather than render an empty framing frame on stale state.
  await expect(page).toHaveURL(/\/home(\/(games|reels))?$/);
  await waitForTabsSettled(page);
  await expect(gamesTab(page)).toBeVisible();
  await saveEvidence(page, 'criterion-4-framing-cold-hit-redirects-home');
});
