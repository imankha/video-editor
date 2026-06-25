import { test, expect } from '@playwright/test';

/**
 * "Re-edit this reel" in-player affordance E2E (T3940).
 *
 * Acceptance criterion locked here (route-mocked, no seeding needed):
 *   - The PUBLIC SharedCollectionView mounts the SAME CollectionPlayer but must
 *     NOT show the Re-edit button (it never passes onReEdit). A viewer with no
 *     ownership / no editor must not see an editor entry point.
 *
 * The authenticated player -> editor navigation (single-clip player, collection
 * "Play all" on the active reel, and the ranker replay -> restore-project -> land
 * in the Framing editor) is exercised at the manual Test & Fix stage with a
 * SEEDED account: it requires a published reel + restorable project, which can't
 * be synthesized without the full export/publish flow. This mirrors the existing
 * collections.spec.js note. The button wiring + gating itself is covered by the
 * CollectionPlayer Vitest (button present with onReEdit + project_id, absent
 * without onReEdit, hidden when project_id is null/0) and the backend
 * /api/rank/next project_id test.
 *
 * Run with dev servers up on 8000/5173:
 *   cd src/frontend && npx playwright test e2e/reedit-reel.spec.js
 */

// Token must match App.jsx's /^\/shared\/collection\/([a-f0-9-]+)$/i route.
const SHARE_TOKEN = 'abc123def456';
const RE_EDIT = 'Re-edit this reel';

test.describe('Re-edit button is absent in the public shared viewer', () => {
  test('public SharedCollectionView player shows no Re-edit affordance', async ({ page }) => {
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
    await expect(page.getByTitle(RE_EDIT)).toHaveCount(0);
  });
});
