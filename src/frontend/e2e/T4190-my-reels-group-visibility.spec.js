import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

/**
 * T4190 - My Reels game group surfaces new reels + real game names (LIVE GUARDRAIL).
 *
 * Drives the app AS THE REAL USER (imankh@gmail.com, prod-copied into dev) and
 * asserts the RENDERED My Reels panel against the live collections summary:
 *
 *   1. Game group headers show the real game name (opponent + date) - never the
 *      anonymous "Game Highlights" that hid which game a reel belonged to.
 *   2. A COLLAPSED game group that contains unwatched reels renders an "N new"
 *      chip on its header, so the My Reels badge always has a visible on-screen
 *      counterpart (a new reel nested in a collapsed group is no longer hidden).
 *
 * Expected values are read from GET /api/collections/summary at runtime (not
 * hardcoded), then checked against the DOM the app renders inside the DownloadsPanel
 * ("My Reels" slide-out). All locators are SCOPED to that panel so they cannot
 * match the ProjectManager's project-group headers (which reuse CollapsibleGroup
 * with status counts but no new-chip) rendered underneath the panel.
 *
 * CollectionsTab default-expands ONLY the first game group (i === 0); every later
 * group renders collapsed on load, so games[i>=1] with unwatched_count > 0 is a
 * genuine collapsed-group-with-new-reels case with no clicking required.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T4190-my-reels-group-visibility.spec.js --reporter=line
 */

const REAL_EMAIL = 'imankh@gmail.com';
const PROFILE_ID = '9fa7378c';

test('T4190: My Reels group headers show real game names + collapsed-group new chip', async ({ context, page }) => {
  // --- auth + read the live summary the UI will render from ------------------
  await loginAsRealUser(context, REAL_EMAIL);

  const res = await context.request.get('/api/collections/summary', {
    headers: { 'X-Profile-ID': PROFILE_ID },
  });
  expect(res.ok(), `collections/summary HTTP ${res.status()}`).toBeTruthy();
  const summary = await res.json();
  const games = summary.games || [];
  console.log('[T4190] live games:', JSON.stringify(
    games.map((g) => ({ id: g.game_id, name: g.game_name, reels: g.reel_count, new: g.unwatched_count })),
  ));

  expect(games.length, 'account must have >= 1 published game group to drive this spec').toBeGreaterThan(0);

  // Criterion 1 source-of-truth: no bucket may carry the anonymous label; every
  // group name must be a real display name (opponent + date).
  for (const g of games) {
    expect(g.game_name, `game ${g.game_id} name`).toBeTruthy();
    expect(g.game_name, `game ${g.game_id} must not be anonymous`).not.toBe('Game Highlights');
  }

  // The first group is default-expanded; find a LATER (collapsed) group that
  // holds unwatched reels - that is the "collapsed group hides new reel" case.
  const expandedGroup = games[0];
  const collapsedNewGroup = games.slice(1).find((g) => (g.unwatched_count || 0) > 0);
  expect(
    collapsedNewGroup,
    'need a non-first game group with unwatched reels (seed one by clearing a final_video.watched_at); ' +
      `live groups: ${JSON.stringify(games.map((g) => ({ name: g.game_name, new: g.unwatched_count })))}`,
  ).toBeTruthy();
  console.log(`[T4190] expanded group: "${expandedGroup.game_name}" (new=${expandedGroup.unwatched_count})`);
  console.log(`[T4190] collapsed+new group: "${collapsedNewGroup.game_name}" (new=${collapsedNewGroup.unwatched_count})`);

  // --- open the My Reels panel (DownloadsPanel slide-out) --------------------
  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /My Reels/i }).first().click({ timeout: 30000 });

  // Scope EVERYTHING to the fixed slide-out panel so we assert the collections
  // view, not the project-manager groups mounted underneath it.
  const panelHeading = page.getByRole('heading', { name: 'My Reels' });
  await panelHeading.waitFor({ timeout: 30000 });
  const panel = page.locator('div.fixed.right-0.top-0').filter({ has: panelHeading });

  // Wait for the collections summary to render the first game group's header.
  const firstHeader = panel.getByRole('button').filter({ hasText: expandedGroup.game_name }).first();
  await firstHeader.waitFor({ timeout: 30000 });

  // --- Criterion 1: real game name in the header, never "Game Highlights" ----
  // T4810 note: the play-all CARD inside an expanded game group now legitimately
  // reads "Game Highlights" (the collection type). T4190's guarantee is narrower
  // and survives: no group HEADER is the anonymous "Game Highlights" - every
  // header shows its game name. Assert on the header buttons, not the whole panel.
  await expect(firstHeader, 'first group header shows the real game name').toBeVisible();
  await expect(
    panel.getByRole('button').filter({ hasText: /^\s*Game Highlights\s*$/ }),
    'no game-group header is the anonymous "Game Highlights"',
  ).toHaveCount(0);

  // --- Criterion 2: collapsed group with unwatched reels shows the "N new" chip ---
  const collapsedHeader = panel
    .getByRole('button')
    .filter({ hasText: collapsedNewGroup.game_name })
    .first();
  await expect(collapsedHeader, 'collapsed group header is rendered').toBeVisible();
  await expect(collapsedHeader, 'collapsed group shows the real game name').toContainText(
    collapsedNewGroup.game_name,
  );
  await expect(collapsedHeader, 'collapsed group shows the N-new chip').toContainText(
    `${collapsedNewGroup.unwatched_count} new`,
  );

  // Prove it is actually COLLAPSED: CollapsibleGroup renders its expanded content
  // div (the header button's only sibling) only when open. A collapsed group's
  // root holds just the <button> header and no content <div>.
  const collapsedRoot = collapsedHeader.locator('xpath=..');
  await expect(
    collapsedRoot.locator(':scope > div'),
    'collapsed group has no expanded content region',
  ).toHaveCount(0);

  console.log(
    `[T4190] PASS: "${collapsedNewGroup.game_name}" renders collapsed with a ` +
      `"${collapsedNewGroup.unwatched_count} new" chip; no anonymous "Game Highlights" group headers.`,
  );
});
