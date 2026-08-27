/**
 * T7040 live-drive QA -- collection download end-to-end.
 *
 * Bug: GET /api/collections/download (T4945) failed client-side with a bare
 * "TypeError: Failed to fetch". Two fixes landed on this branch:
 *   - /api/exports/active no longer blocks the event loop while sweeping stale
 *     jobs (was starving concurrent requests, incl. this download);
 *   - the collection stitch/compose runs BEFORE the StreamingResponse so a
 *     failure is a clean HTTP status, never a mid-stream abort.
 *
 * This spec confirms the happy path still works end-to-end: a real owner
 * downloads a collection and gets a playable MP4. Driven against the running
 * container as the real account via dev-login (MODAL_ENABLED=false under
 * dev-verify, so this exercises the LOCAL ffmpeg stitch branch).
 *
 * Run:
 *   bash scripts/dev-verify.sh e2e/T7040-collection-download.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { loginAsRealUser } from './helpers/realAuth.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const execFileP = promisify(execFile);

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function probeVideo(filePath) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-show_entries', 'stream=width,height,codec_type',
    '-of', 'json',
    filePath,
  ]);
  return JSON.parse(stdout);
}

test.describe('T7040 collection download', () => {
  // T7800: local ffprobe + relative /api request-context fetch + local-ffmpeg premise.
  skipOnDeployedTarget(test, 'local ffprobe binary + relative /api fetch (SPA fallback on split-host staging)');
  let ownerCtx;

  test.beforeAll(async ({ browser }) => {
    ownerCtx = await browser.newContext();
    await loginAsRealUser(ownerCtx, EMAIL, PROFILE);
  });

  test.afterAll(async () => {
    await ownerCtx?.close();
  });

  test('owner downloads a collection -> playable MP4 (no Failed to fetch)', async () => {
    // scope_type=all with a small budget_sec caps the stitch to a couple of
    // members so the LOCAL ffmpeg concat (dev-verify forces MODAL_ENABLED=false)
    // finishes quickly -- prod offloads the arbitrary-N concat to Modal. The
    // full unbounded collection also returns 200 here, just slowly (a 44-reel
    // CPU re-encode ran ~134s in one manual run); this bounds the QA run.
    const resp = await ownerCtx.request.get(
      '/api/collections/download?scope_type=all&aspect_ratio=9:16&budget_sec=15',
      { timeout: 180_000 },
    );
    expect(
      resp.ok(),
      `GET /api/collections/download must succeed (got ${resp.status()})`,
    ).toBeTruthy();
    expect(resp.headers()['content-type']).toContain('video/mp4');

    const buf = await resp.body();
    expect(buf.length, 'downloaded MP4 must be non-empty').toBeGreaterThan(1000);

    const localFile = path.join(os.tmpdir(), `t7040-coll-${Date.now()}.mp4`);
    fs.writeFileSync(localFile, buf);

    const info = await probeVideo(localFile);
    const duration = parseFloat(info.format?.duration);
    expect(duration, 'stitched collection must have a real duration').toBeGreaterThan(0);
    expect(
      (info.streams || []).some((s) => s.codec_type === 'video'),
      'stitched collection must contain a video stream',
    ).toBeTruthy();
    console.log(
      `[T7040] collection download OK: ${buf.length} bytes, ${duration.toFixed(2)}s -> ${localFile}`,
    );
  });
});
