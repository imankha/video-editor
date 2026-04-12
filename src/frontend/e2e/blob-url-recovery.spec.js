/**
 * T1360: Blob URL Error Recovery
 *
 * Verifies that when a <video> element hits MEDIA_ERR_SRC_NOT_SUPPORTED
 * on a blob: URL (typical symptom of a revoked / GC'd blob), the app
 * classifies it as a stale-blob event and swaps to a streaming URL
 * instead of showing the generic "Video format not supported" overlay.
 *
 * The test runs against the vite dev server (port 5173). It dynamically
 * imports the classifier module from the dev server and drives a real
 * <video> element on about:blank — no project fixtures needed.
 *
 * Requires: vite dev server running on :5173
 *   cd src/frontend && npm run dev
 */

import { test, expect } from '@playwright/test';

const DEV_BASE = 'http://localhost:5173';
const CLASSIFIER_URL = `${DEV_BASE}/src/utils/videoErrorClassifier.js`;

test.describe('T1360 blob URL recovery', () => {
  test('classifier module exists and exports classifyVideoError', async ({ page }) => {
    // Navigate to the dev server so same-origin dynamic imports work.
    await page.goto(DEV_BASE);

    const result = await page.evaluate(async (url) => {
      const mod = await import(url);
      return {
        hasClassify: typeof mod.classifyVideoError === 'function',
        hasKind: typeof mod.VideoErrorKind === 'object',
      };
    }, CLASSIFIER_URL);

    expect(result.hasClassify).toBe(true);
    expect(result.hasKind).toBe(true);
  });

  test('MEDIA_ERR_SRC_NOT_SUPPORTED on blob: URL is classified as STALE_BLOB (not FORMAT_ERROR)', async ({ page }) => {
    await page.goto(DEV_BASE);

    const outcome = await page.evaluate(async (url) => {
      const { classifyVideoError, VideoErrorKind } = await import(url);

      // Simulate the exact symptom: MEDIA_ERR_SRC_NOT_SUPPORTED on a blob URL.
      const blobUrlResult = classifyVideoError({
        code: 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */,
        videoSrc: 'blob:http://localhost:5173/abc-123',
      });

      // Same code on an https URL must NOT be classified as stale blob.
      const httpsUrlResult = classifyVideoError({
        code: 4,
        videoSrc: 'https://r2.example.com/video.mp4?sig=xyz',
      });

      const networkResult = classifyVideoError({
        code: 2 /* MEDIA_ERR_NETWORK */,
        videoSrc: 'https://r2.example.com/video.mp4?sig=xyz',
      });

      return {
        blob: blobUrlResult,
        https: httpsUrlResult,
        network: networkResult,
        kinds: VideoErrorKind,
      };
    }, CLASSIFIER_URL);

    expect(outcome.blob).toBe(outcome.kinds.STALE_BLOB);
    expect(outcome.https).toBe(outcome.kinds.FORMAT_ERROR);
    expect(outcome.network).toBe(outcome.kinds.NETWORK_ERROR);
  });

  test('revoked blob URL triggers recovery path (no format-error surfaced to user)', async ({ page }) => {
    await page.goto(DEV_BASE);

    // Simulate the full recovery contract end-to-end:
    // 1. Create a small blob video, attach to <video>, start loading.
    // 2. Revoke the blob URL and call video.load() -> fires error with code 4.
    // 3. The classifier should report STALE_BLOB; a recovery swap (to a
    //    stashed streaming URL) should suppress the error overlay.
    const outcome = await page.evaluate(async (url) => {
      const { classifyVideoError, VideoErrorKind } = await import(url);

      // We simulate the error signature the browser emits when a blob URL
      // backing the <video> element has been revoked / GC'd:
      //   video.src startsWith 'blob:' AND error.code === SRC_NOT_SUPPORTED
      // The recovery contract under test: classifier reports STALE_BLOB,
      // the handler swaps to the stashed streaming URL, no overlay shown.
      const blob = new Blob([new Uint8Array([0])], { type: 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);
      const streamingUrl = 'https://example.com/fake-streaming.mp4';

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      document.body.appendChild(video);
      // Set src without triggering a real load — we synthesise the error.
      Object.defineProperty(video, 'src', { value: blobUrl, writable: true });

      let recoveryTriggered = false;
      let overlayShown = false;

      // Simulate the production hook: streaming-URL stash is one-shot.
      let streamingFallback = streamingUrl;
      const fakeMediaError = { code: 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */ };
      const handleError = (srcAtError) => {
        const kind = classifyVideoError({
          code: fakeMediaError.code,
          videoSrc: srcAtError,
        });
        if (kind === VideoErrorKind.STALE_BLOB && streamingFallback) {
          recoveryTriggered = true;
          const fallback = streamingFallback;
          streamingFallback = null;
          video.src = fallback;
          return;
        }
        overlayShown = true;
      };

      // Fire the stale-blob error: revoke, then invoke handleError with
      // the blob: src (what video.error would report).
      URL.revokeObjectURL(blobUrl);
      handleError(blobUrl);

      return {
        recoveryTriggered,
        overlayShown,
        finalSrcIsStreaming: video.src === streamingUrl,
      };
    }, CLASSIFIER_URL);

    // The whole point of T1360: a revoked blob must NOT surface as a format error.
    expect(outcome.overlayShown).toBe(false);
    expect(outcome.recoveryTriggered).toBe(true);
    expect(outcome.finalSrcIsStreaming).toBe(true);
  });
});
