/**
 * T11990 QA — closing the finished-highlight viewer (X) lands on Home's
 * Finished tab with the new highlight listed, clears the Annotate breadcrumb,
 * and leaves "Back to game plays" going to Annotate (decision Q14, reversing
 * ae11fd75c's "return to Annotate on close").
 *
 * Drives the REAL app shell (App.jsx -> ProjectManager -> PublishedReelsPanel
 * -> CollectionsTab -> JustPublishedCard, and the REAL DraftReelPreview/
 * CollectionPlayer) against a fresh e2e test-login user (new-user bypass,
 * CLAUDE.md "Testing Auth Bypass" / frontend CLAUDE.md), mocking only the
 * network boundary this account has no real data for (collections summary,
 * the game's download member list, the video stream, and the poster) --
 * never the component tree, same approach T10180's qa spec established for
 * this exact component.
 *
 * Run: bash scripts/dev-verify.sh e2e/T11990-finished-viewer-close-landing.qa.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';

const FINAL_VIDEO_ID = 911990;
const GAME_ID = 55;
const PROJECT_ID = 42;
const SOURCE_CLIP_ID = 123;

const BUCKET = {
  reel_count: 1, unwatched_count: 0, ratio_counts: {}, ratio_durations: {},
  ratio_eligible: {}, total_duration: 0, has_null_durations: false,
  latest_published_at: null,
};

async function setupTestUser(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': 'e2e-t11990', 'X-Test-Mode': 'true' });
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
    useAuthStore.setState({ isAuthenticated: true, email: 'e2e-t11990@e2e.local', showAuthModal: false });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

/** Mocks the data this fresh account has none of, so the Published tab
 * resolves to a non-empty, deterministic "just published" highlight. */
async function mockPublishedHighlight(page) {
  await page.route('**/api/collections/summary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        smart_collections: [],
        mixes: { reel_count: 0 },
        games: [{ ...BUCKET, game_id: GAME_ID, game_name: 'Lakers', game_date: null }],
        game_groups: [],
      }),
    })
  );
  await page.route(`**/api/downloads?game_id=${GAME_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        downloads: [{
          id: FINAL_VIDEO_ID,
          project_name: 'Brilliant Dribble',
          aspect_ratio: '9:16',
          game_names: ['Lakers'],
          created_at: new Date().toISOString(),
          duration: 12,
          clip_game_start_time: 750,
        }],
      }),
    })
  );
  await page.route(`**/api/downloads/${FINAL_VIDEO_ID}/poster.jpg**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) })
  );
  await page.route(`**/api/downloads/${FINAL_VIDEO_ID}/stream**`, (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from([]) })
  );
}

/** Drives the real finishedReelNav.openFinishedReel entry point (the SAME
 * primitive "Finish" uses) plus the real galleryStore.setJustPublished
 * signal a real publish already fires -- reproducing "just finished a
 * highlight" state without reimplementing it. */
async function openFinishedHighlight(page, { annotateOrigin } = {}) {
  await page.evaluate(
    async ({ projectId, finalVideoId, gameId, sourceClipId, annotateOrigin }) => {
      const { useGalleryStore } = await import('/src/stores/galleryStore.js');
      const { setAnnotateOrigin } = await import('/src/utils/pendingNavigation.js');
      const { openFinishedReel } = await import('/src/utils/finishedReelNav.js');
      if (annotateOrigin) setAnnotateOrigin(projectId, gameId, sourceClipId);
      useGalleryStore.getState().setJustPublished({ finalVideoId, gameId, aspectRatio: '9:16' });
      openFinishedReel(
        {
          id: projectId,
          final_video_id: finalVideoId,
          name: 'Brilliant Dribble',
          aspect_ratio: '9:16',
          clip_count: 1,
          game_names: ['Lakers'],
          clip_game_start_time: 750,
          game_ids: [gameId],
        },
        { alreadyPublished: true }
      );
    },
    { projectId: PROJECT_ID, finalVideoId: FINAL_VIDEO_ID, gameId: GAME_ID, sourceClipId: SOURCE_CLIP_ID, annotateOrigin }
  );
}

test.describe('T11990: closing the finished-highlight viewer lands on Home Finished tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestUser(page);
    await mockPublishedHighlight(page);
  });

  test('C1: X closes to Home on the Finished tab with the new highlight listed, even with a matching Annotate breadcrumb (Q14 reversal)', async ({ page }) => {
    await openFinishedHighlight(page, { annotateOrigin: true });

    // The real DraftReelPreview/CollectionPlayer is up (mocked stream only).
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible({ timeout: 10000 });
    await saveEvidence(page, 'T11990-C1-preview-open-with-breadcrumb');

    await page.getByRole('button', { name: 'Close' }).click();

    // Lands on Home's Finished tab (not Annotate, even though a matching
    // annotateOrigin breadcrumb was set) -- URL is the source of truth for
    // editorMode + ProjectManager's active tab (TAB_PATHS).
    await expect(page).toHaveURL(/\/home\/published$/, { timeout: 10000 });

    // The new highlight is listed: the just-published spotlight card renders
    // with the correct video.
    const card = page.getByTestId('just-published-card');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText('Brilliant Dribble');
    await saveEvidence(page, 'T11990-C1-home-finished-tab-with-highlight');

    // The Annotate breadcrumb was cleared (read via the real util), so a LATER
    // unrelated close/back-to-game-plays flow can't misfire against it.
    const originAfterClose = await page.evaluate(async (projectId) => {
      const { peekAnnotateOrigin } = await import('/src/utils/pendingNavigation.js');
      return peekAnnotateOrigin(projectId);
    }, PROJECT_ID);
    expect(originAfterClose).toBeNull();
  });

  test('C1 (no breadcrumb case): a plain close with no Annotate origin also lands on Home Finished', async ({ page }) => {
    await openFinishedHighlight(page, { annotateOrigin: false });

    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page).toHaveURL(/\/home\/published$/, { timeout: 10000 });
    await expect(page.getByTestId('just-published-card')).toBeVisible({ timeout: 10000 });
  });

  test('C2: "Back to game plays" still goes to Annotate (unchanged)', async ({ page }) => {
    await openFinishedHighlight(page, { annotateOrigin: false });

    const backLink = page.getByTitle('Back to game plays');
    await expect(backLink).toBeVisible({ timeout: 10000 });
    await saveEvidence(page, 'T11990-C2-back-to-game-plays-visible');

    await backLink.click();

    await expect(page).toHaveURL(/\/annotate/, { timeout: 10000 });
    await saveEvidence(page, 'T11990-C2-landed-on-annotate');
  });
});
