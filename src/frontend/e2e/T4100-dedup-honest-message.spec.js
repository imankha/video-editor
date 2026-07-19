/**
 * T4100 fix 3 -- LIVE drive of the dedup honest-message path.
 *
 * Runs the REAL frontend upload pipeline in a REAL browser (hashAndAnalyze ->
 * createGame -> dedup shortcut -> uploadStore.progressHandler), forcing the
 * dedup branch at the backend boundary (POST /api/games -> already_owned) so
 * there is NO R2 write and NO real game created on the dev account.
 *
 * Why capture the store stream instead of asserting the DOM: the fix makes the
 * dedup path INSTANT (it removed the old 30/70/100% + 400ms sleeps), so the
 * "Already uploaded - finishing up" FINALIZING frame is superseded by COMPLETE
 * within the same tick and activeUpload is nulled -- not reliably observable via
 * DOM polling. Subscribing to the store records the transient frame reliably.
 * (UploadProgressIndicator.test.jsx proves the component renders these messages.)
 *
 * The fixture is a 2.2KB faststart MP4 (ffmpeg color source) inlined as base64
 * so the spec is self-contained -- e2e video fixtures are gitignored (*.mp4).
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

// tiny valid faststart mp4 (moov at front), 64x64 1s, so hashAndAnalyze parses it.
const FIXTURE_B64 =
  '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';

test('dedup upload shows the honest message, not a fake progress crawl', async ({ page, context }) => {
  // T5420: inspects dedup state by import()ing /src/stores/uploadStore.js in-page — that
  // Vite-dev /src path 404s on a deployed CF Pages BUILD. Skip loudly on a deployed target.
  skipOnDeployedTarget(test, "import()s /src/stores/uploadStore.js (Vite-dev path; 404s on a deployed build)");
  await loginAsRealUser(context); // imankh@gmail.com -- real session cookie

  // Force dedup: intercept ONLY the create-game POST; everything else passes
  // through. already_owned makes uploadGame short-circuit to the honest path.
  await page.route('**/api/games', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'already_owned',
          game_id: 999999001,
          name: 'T4100 Dedup Probe',
          video_url: 'https://example.invalid/x.mp4',
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Let the SPA settle: after dev-login it may client-side redirect from '/',
  // which would destroy an evaluate context fired too early.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Drive the real store; record every activeUpload {phase,message} transition.
  await page.evaluate(async (base64) => {
    const { useUploadStore } = await import('/src/stores/uploadStore.js');
    window.__msgs = [];
    useUploadStore.subscribe((s) => {
      if (s.activeUpload) {
        window.__msgs.push({ phase: s.activeUpload.phase, message: s.activeUpload.message });
      }
    });
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 't4100-probe.mp4', { type: 'video/mp4' });
    useUploadStore.getState().startUpload(
      file,
      { opponentName: 'T4100 Dedup Probe' },
      { duration: 1, width: 64, height: 64 },
    );
  }, FIXTURE_B64);

  // The honest dedup message must appear in the captured user-visible stream.
  await page.waitForFunction(
    () => (window.__msgs || []).some((m) => /already uploaded/i.test(m.message || '')),
    { timeout: 20000 },
  );

  const msgs = await page.evaluate(() => window.__msgs);
  console.log('[dedup-drive] captured store messages:', JSON.stringify(msgs));

  // 1. Honest dedup message surfaced verbatim to the store (what the indicator renders).
  expect(msgs.some((m) => m.message === 'Already uploaded - finishing up')).toBeTruthy();
  // 2. No fabricated "upload" crawl: the dedup path never enters the UPLOADING phase.
  expect(msgs.some((m) => m.phase === 'uploading')).toBeFalsy();
  // 3. It still reaches completion.
  expect(msgs.some((m) => m.phase === 'complete')).toBeTruthy();
});
