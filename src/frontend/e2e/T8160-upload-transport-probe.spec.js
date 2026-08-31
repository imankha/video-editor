import crypto from 'crypto';

import { test, expect } from '@playwright/test';

/**
 * T8160 upload-transport probe — proves the multipart upload TRANSPORT is alive
 * end-to-end against the target: prepare-upload with a NOVEL hash -> a real part
 * PUT to the presigned R2 URL -> clean cancel.
 *
 * WHY THIS EXISTS (the 2026-08-30 prod outage, bug 47p): prepare-upload aborted
 * its own just-created multipart (R2 returns per-call UploadId aliases, so
 * T7950's keep-comparison never matched), and every part PUT 404'd
 * (NoSuchUpload). NO existing e2e could see it, for two stacked reasons:
 *   1. No @staging-gate spec uploaded a game at all (full-workflow.spec.js is
 *      not a gate member).
 *   2. Any spec re-uploading a FIXTURE file dedups: games/{hash}.mp4 is a
 *      shared, env-prefix-free namespace, so prepare returns EXISTS and zero
 *      parts are ever PUT. Only a NOVEL hash exercises the multipart path.
 *
 * This probe is deliberately API-level and side-effect-free:
 *   - novel random hash every run -> always takes the multipart path, never dedup
 *   - the part PUT is the exact operation that 404'd during the outage
 *   - cancel-upload aborts the multipart + deletes the pending row, so no R2
 *     object is ever created, no game row exists, and no credits are charged
 *
 * Auth: test-login (X-Test-Mode) — works on local dev and staging, blocked in
 * prod. Uses its own e2e@test.local session, so it cannot CAS-conflict with the
 * lane accounts (lane C carries the no-account members).
 */

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';

// 6MB -> exactly 2 parts at the 5MB PART_SIZE; we PUT the first (full-size) part.
const FILE_SIZE = 6 * 1024 * 1024;

function novelHash() {
  return crypto.randomBytes(32).toString('hex'); // valid 64-hex blake3 shape
}

test.describe('T8160 upload transport probe @staging-gate @gate-c', () => {
  test('novel-hash prepare -> part PUT succeeds -> cancel', async ({ request }) => {
    // 1. Session (test-login is idempotent; retry the staging first-login 500).
    let login;
    for (let attempt = 0; attempt < 3; attempt++) {
      login = await request.post(`${API_BASE}/auth/test-login`, {
        headers: { 'X-Test-Mode': 'true' },
        data: {},
      });
      if (login.ok()) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    expect(login.ok(), `test-login -> ${login.status()}`).toBeTruthy();

    // 2. Prepare with a hash no file has ever had -> must take the multipart path.
    const prepare = await request.post(`${API_BASE}/games/prepare-upload`, {
      headers: { 'X-Test-Mode': 'true' },
      data: {
        blake3_hash: novelHash(),
        file_size: FILE_SIZE,
        original_filename: 't8160-transport-probe.mp4',
      },
    });
    expect(prepare.ok(), `prepare-upload -> ${prepare.status()}`).toBeTruthy();
    const prep = await prepare.json();
    expect(prep.status, 'novel hash must require an upload (EXISTS would mean the probe is not novel)').toBe('upload_required');
    expect(prep.is_resume).toBe(false);
    expect(prep.parts.length).toBeGreaterThan(0);

    // 3. THE outage check: a real bytes PUT to the first presigned part URL.
    //    During the T8160 outage this deterministically returned 404 NoSuchUpload
    //    because prepare had already aborted its own multipart.
    const part = prep.parts[0];
    const partBytes = crypto.randomBytes(part.end_byte - part.start_byte + 1);
    const put = await request.put(part.presigned_url, { data: partBytes, timeout: 120000 });
    const putBody = put.ok() ? '' : await put.text();
    expect(
      put.status(),
      `part ${part.part_number} PUT -> ${put.status()} ${putBody.slice(0, 200)} ` +
        '(404 NoSuchUpload here means prepare killed its own multipart — the bug 47p outage)',
    ).toBe(200);
    expect(put.headers()['etag'], 'R2 must return an ETag for the stored part').toBeTruthy();
    console.log(`[t8160-probe] part PUT 200, etag=${put.headers()['etag']}`);

    // 4. Clean up: abort the multipart + delete the pending row (no object, no
    //    game, no credits — the probe leaves zero residue).
    const cancel = await request.delete(`${API_BASE}/games/upload/${prep.upload_session_id}`, {
      headers: { 'X-Test-Mode': 'true' },
    });
    expect(cancel.ok(), `cancel-upload -> ${cancel.status()}`).toBeTruthy();
  });
});
