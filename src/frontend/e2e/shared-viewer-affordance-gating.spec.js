import { test, expect } from '@playwright/test';

/**
 * In-player editor-affordance gating in the PUBLIC shared viewer (T3940 Re-edit,
 * T4030 Re-rank) — merged from reedit-reel.spec.js + rerank-reel.spec.js (T7770),
 * which were structural twins differing only in the affordance title.
 *
 * Acceptance criterion locked here (route-mocked, no seeding needed):
 *   - The PUBLIC SharedCollectionView mounts the SAME CollectionPlayer but must
 *     NOT show any editor entry point (it never passes onReEdit / onReRank). A
 *     viewer with no ownership / no editor must not see a way to re-open someone
 *     else's reel for editing or ranking.
 *
 * The authenticated author flows are exercised deterministically elsewhere and at
 * the manual Test & Fix stage with a SEEDED account (they need a published reel +
 * restorable project / ranking pool that can't be synthesized without the full
 * export/publish flow):
 *   - Re-edit: player -> editor navigation (single-clip player, collection "Play
 *     all", ranker replay -> restore-project -> Framing editor). Button wiring +
 *     gating covered by the CollectionPlayer Vitest (present with onReEdit +
 *     project_id, absent without, hidden when project_id is null/0) and the backend
 *     /api/rank/next project_id test.
 *   - Re-rank: tap Re-rank -> POST /api/rank/reopen -> reel re-enters /api/rank/next
 *     AND the Confidence banner % drops, locked by the backend integration test
 *     (tests/test_reel_ranking.py::TestRankEndpoints::
 *      test_reopen_clip_reappears_in_next_and_confidence_drops) and the
 *     CollectionPlayer Vitest (present with onReRank + single-clip project, absent
 *     without, hidden for multi-clip/Mixes and project-less reels).
 * This mirrors the existing collections.spec.js note.
 *
 * Run with dev servers up on 8000/5173:
 *   cd src/frontend && npx playwright test e2e/shared-viewer-affordance-gating.spec.js
 */

// Token must match App.jsx's /^\/shared\/collection\/([a-f0-9-]+)$/i route.
const SHARE_TOKEN = 'abc123def456';

// Each editor affordance the public viewer must NOT expose, by its getByTitle string.
const AFFORDANCES = [
  { name: 'Re-edit', title: 'Re-edit this reel' },
  { name: 'Re-rank', title: 'Re-rank this reel' },
];

test.describe('Editor affordances are absent in the public shared viewer', () => {
  for (const { name, title } of AFFORDANCES) {
    test(`public SharedCollectionView player shows no ${name} affordance`, async ({ page }) => {
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

      // The editor entry point must NOT exist for a public viewer.
      await expect(page.getByTitle(title)).toHaveCount(0);
    });
  }
});
