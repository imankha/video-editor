/**
 * T9600 QA — Kill contradictory status labels.
 *
 * Verifies the canonical draftStage vocabulary now renders on every reel-status
 * surface, and that the misleading "Ready to share" literal (which read as
 * "already shared" for a private draft) is gone. Deterministic: it SPLICES
 * crafted reels at each pipeline stage into the /api/bootstrap payload (the real
 * source of the initial project list) on top of a real-user session, so the
 * evidence never depends on the account's live data.
 *
 * Acceptance mapping:
 *  - #1/#2: reel-status words derive from draftStage.js ("Ready to Publish",
 *           "Draft - in Spotlight"); no undefined word appears.
 *  - #3:    no surface labels a private draft as already shared -> ZERO
 *           "Ready to share" text anywhere on the page.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

// Crafted reels (is_auto_created: false -> the "Reels" tab). One per stage whose
// label this task touches.
const MOCK_PROJECTS = [
  {
    // Published final -> the recent-project row must read terminal "Done", NOT
    // "Ready to Publish" (Site 3 guard: draftStage READY spans published too, so
    // the row keeps DraftTile's published/ready split). Newest timestamp so it is
    // sortedProjects[0] and drives the "Continue where you left off" row.
    id: 90004, name: 'QA Published Reel', aspect_ratio: '9:16',
    clip_count: 1, clips_in_progress: 0, clips_exported: 1,
    has_working_video: true, has_overlay_edits: false, has_final_video: true,
    is_published: true, is_auto_created: false, game_ids: [], clips: [],
    created_at: '2026-09-11T00:00:09Z', updated_at: '2026-09-11T00:00:09Z',
    last_opened_at: '2026-09-11T00:00:09Z',
  },
  {
    // READY, not yet published -> DraftTile badge "Ready to Publish" (Site 1).
    id: 90001, name: 'QA Ready To Publish Reel', aspect_ratio: '9:16',
    clip_count: 1, clips_in_progress: 0, clips_exported: 1,
    has_working_video: true, has_overlay_edits: false, has_final_video: true,
    is_published: false, is_auto_created: false, game_ids: [], clips: [],
    created_at: '2026-09-11T00:00:03Z', updated_at: '2026-09-11T00:00:03Z',
  },
  {
    // IN_OVERLAY (working video, no final) -> SegmentedProgressStrip 'ready'
    // Spotlight segment tooltip "Draft - in Spotlight" (Site 2), and the
    // DraftTile status chip "In Spotlight".
    id: 90003, name: 'QA In Spotlight Reel', aspect_ratio: '9:16',
    clip_count: 1, clips_in_progress: 0, clips_exported: 1,
    has_working_video: true, has_overlay_edits: false, has_final_video: false,
    is_published: false, is_auto_created: false, game_ids: [], clips: [],
    created_at: '2026-09-11T00:00:02Z', updated_at: '2026-09-11T00:00:02Z',
  },
];

test('T9600: reel-status surfaces use draftStage vocabulary, never "Ready to share"', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com');

  // Splice crafted reels into the bootstrap payload (real source of the list),
  // passing every other field through untouched.
  await context.route(/\/api\/bootstrap$/, async (route) => {
    const resp = await route.fetch();
    const json = await resp.json();
    json.projects = MOCK_PROJECTS;
    await route.fulfill({ response: resp, json });
  });
  // Also stub the on-transition list refetch so it can't overwrite the splice.
  await context.route(/\/api\/projects$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PROJECTS) });
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // --- Criterion #3 on the landing view: the misleading literal is gone. ---
  await expect(page.getByText('Ready to share', { exact: false })).toHaveCount(0);

  // --- Site 3 guard (reviewer MAJOR): the most-recent reel is PUBLISHED, so the
  //     "Continue where you left off" row must read terminal "Done", never
  //     "Ready to Publish" (which would falsely say a live reel is still private). ---
  const recentRow = page.getByRole('button').filter({ hasText: 'QA Published Reel' }).first();
  await expect(recentRow).toBeVisible({ timeout: 15000 });
  await expect(recentRow).toContainText('Done');
  await expect(recentRow).not.toContainText('Ready to Publish');
  await page.screenshot({ path: '/workspace/qa/T9600-landing-view.png', fullPage: true });

  // Open the Reels tab (In Progress Reels), where the crafted reels render.
  await page.getByRole('button', { name: /^Reels/ }).click();
  await expect(page.getByText('QA Ready To Publish Reel').first()).toBeVisible({ timeout: 15000 });

  // Criterion #3 again on the reels view.
  await expect(page.getByText('Ready to share', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: '/workspace/qa/T9600-reels-view.png', fullPage: true });

  // --- Site 1: the ready tile's badge is exactly the canonical READY label. ---
  const readyCard = page.locator('[data-testid="project-card"]', { hasText: 'QA Ready To Publish Reel' }).first();
  await expect(readyCard.getByText('Ready to Publish').first()).toBeVisible();
  await readyCard.screenshot({ path: '/workspace/qa/T9600-ready-badge.png' });

  // --- Site 2: the in-overlay reel's Spotlight segment tooltip reads the
  //     canonical IN_OVERLAY word, not "Ready to share". ---
  const overlayCard = page.locator('[data-testid="project-card"]', { hasText: 'QA In Spotlight Reel' }).first();
  const spotlightSeg = overlayCard.locator('[title^="Spotlight:"]').first();
  await expect(spotlightSeg).toHaveCount(1);
  const tip = await spotlightSeg.getAttribute('title');
  expect(tip).toContain('Draft - in Spotlight');
  expect(tip).not.toContain('Ready to share');
  console.log('[T9600] Spotlight segment tooltip =', JSON.stringify(tip));
  await overlayCard.screenshot({ path: '/workspace/qa/T9600-in-spotlight-card.png' });
});
