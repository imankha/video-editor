import { test, expect } from '@playwright/test';

/**
 * "Re-rank this reel" in-player affordance E2E (T4030).
 *
 * Acceptance criterion locked here (route-mocked, no seeding needed):
 *   - The PUBLIC SharedCollectionView mounts the SAME CollectionPlayer but must
 *     NOT show the Re-rank control (it never passes onReRank). A viewer with no
 *     ownership must not be able to re-open someone else's reel for ranking.
 *
 * The authenticated author flow (tap Re-rank -> POST /api/rank/reopen -> the reel
 * re-enters /api/rank/next AND the Confidence banner % drops) is locked
 * deterministically by the backend integration test
 * (tests/test_reel_ranking.py::TestRankEndpoints::
 *  test_reopen_clip_reappears_in_next_and_confidence_drops) and the CollectionPlayer
 * Vitest (control present with onReRank + single-clip project, absent without
 * onReRank, hidden for multi-clip/Mixes and project-less reels). The full
 * watch-surface flow requires a published single-clip reel + ranking pool, which
 * can't be synthesized without the export/publish flow -- it's exercised at the
 * manual Test & Fix stage with a seeded account, mirroring reedit-reel.spec.js /
 * collections.spec.js.
 *
 * Run with dev servers up on 8000/5173:
 *   cd src/frontend && npx playwright test e2e/rerank-reel.spec.js
 */

// Token must match App.jsx's /^\/shared\/collection\/([a-f0-9-]+)$/i route.
const SHARE_TOKEN = 'abc123def456';
const RE_RANK = 'Re-rank this reel';

test.describe('Re-rank control is absent in the public shared viewer', () => {
  test('public SharedCollectionView player shows no Re-rank affordance', async ({ page }) => {
    // Mock the public share endpoint so the viewer renders without a real share.
    await page.route(`**/api/shared/collection/${SHARE_TOKEN}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: 'Game Highlights',
          aspect_ratio: '9:16',
          members: [
            { id: 1, name: 'Goal vs Carlsbad', presigned_url: 'about:blank', duration: 10 },
          ],
        }),
      }),
    );

    await page.goto(`/shared/collection/${SHARE_TOKEN}`);

    // The shared player chrome is up (the public Share button is always present).
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();

    // The re-rank entry point must NOT exist for a public viewer.
    await expect(page.getByTitle(RE_RANK)).toHaveCount(0);
  });
});
