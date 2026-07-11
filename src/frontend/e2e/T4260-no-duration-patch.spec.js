import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T4260 No duration PATCH during Annotate load.
 *
 * Before T4260, AnnotateContainer.jsx had a loadedmetadata event handler that
 * PATCHed /api/games/{id}/duration when the video element reported a duration
 * longer than the stored value. This was the last banned reactive effect->API
 * write in the codebase. T4260 deleted the handler and moved duration
 * authority to ffprobe at upload finalize.
 *
 * This spec loads Annotate with a real game and asserts -- via network request
 * monitoring -- that NO PATCH matching /duration is ever made during:
 *   - page navigation to /annotate
 *   - /api/games/{id}/load response
 *   - the 3-second window after load (enough time for any loadedmetadata
 *     handler to have fired under the old code)
 *
 * The spec uses real auth (imankh@gmail.com) and dynamically discovers the
 * first available game from /api/bootstrap. Falls back to game 6 (known dev
 * seed from T4110) if bootstrap returns no games.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T4260-no-duration-patch.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';

test('T4260 annotate load fires NO PATCH .../duration (reactive write deleted)', async ({
  context,
  page,
}) => {
  test.setTimeout(60000);

  await loginAsRealUser(context, REAL_EMAIL);

  // Accumulate any PATCH .../duration requests -- the list must stay empty.
  const patchDurationRequests = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && /\/duration/.test(req.url())) {
      patchDurationRequests.push(`${req.method()} ${req.url()}`);
      console.error(`[T4260] UNEXPECTED PATCH: ${req.url()}`);
    }
  });

  // Discover a real game ID from this user's bootstrap data.
  let gameId = 6; // fallback: T4110's known dev-seed game
  const bootstrapRes = await context.request.get('/api/bootstrap', {
    headers: { 'X-Profile-ID': PROFILE_ID },
  });
  if (bootstrapRes.ok()) {
    const data = await bootstrapRes.json().catch(() => ({}));
    const first = (data.games || [])[0];
    if (first?.id) gameId = first.id;
  }
  console.log(`[T4260] using game ${gameId}`);

  // Navigate to Annotate for this game via the pendingGameId breadcrumb.
  await openGameInAnnotate(page, gameId);

  // Wait for the /load API to return (game data applied, event handlers mounted).
  // Timeout is soft -- if the game video is unavailable in dev, load may 404,
  // but the annotate screen still mounts and the old PATCH code would have run.
  await page
    .waitForResponse(
      (res) => res.url().includes(`/api/games/${gameId}/load`),
      { timeout: 30000 },
    )
    .catch(() => console.warn('[T4260] /load response not observed within 30s (game may be unavailable in dev)'));

  // Hold 3 seconds after load -- the old loadedmetadata PATCH fired here.
  // The deleted handler cannot fire, but we give it the same time budget to
  // confirm nothing slipped through.
  await page.waitForTimeout(3000);

  await saveEvidence(page, 'T4260-annotate-loaded-no-patch');

  // The core assertion: the deleted reactive write never fired.
  expect(
    patchDurationRequests,
    `PATCH .../duration must NOT fire during Annotate load.\nCaptured: ${patchDurationRequests.join(', ')}`,
  ).toHaveLength(0);
});
