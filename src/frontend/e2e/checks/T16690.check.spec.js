import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { openGameDetailsDisclosure } from '../helpers/gameDetails.js';

/**
 * T16690: uploading a game lowers the balance by the cost the upload dialog showed.
 *
 * The bug: the charge was keyed `game_upload:<game id>`, game ids count per PROFILE,
 * and the ledger is per ACCOUNT, so game 1 of a second profile found game 1 of the
 * first profile's key already spent and was stored for free. Setup (not the asserted
 * gesture) makes two fresh profiles so both uploads are each profile's game 1; the
 * user gesture (pick a video, press Upload game) runs in each, and both must be paid.
 * The profiles are deleted afterwards.
 */
test.setTimeout(540000); // two real uploads on a cold dev stack took ~6 min

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_VIDEO = path.resolve(__dirname, '../../../../formal annotations/test.short/game2-test.mp4');

// In-page fetch: on staging, page.request after the app has started its own session gets 401 (T16100).
async function pageApi(page, apiPath, init = {}) {
  return page.evaluate(async ({ url, init: i }) => {
    const res = await fetch(url, {
      credentials: 'include',
      ...i,
      headers: { 'Content-Type': 'application/json', ...(i.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body };
  }, { url: checkApi(apiPath), init });
}

async function balance(page) {
  const r = await pageApi(page, '/credits');
  expect(r.status, 'GET /credits').toBe(200);
  return r.body.balance;
}

function uniqueVideo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't16690-'));
  const file = path.join(dir, `t16690-${tag}.mp4`);
  fs.copyFileSync(SOURCE_VIDEO, file);
  // Random tail bytes: a new content hash, so the upload is a new game, not a dedupe.
  fs.appendFileSync(file, Buffer.from(Array.from({ length: 256 * 1024 }, () => Math.floor(Math.random() * 256))));
  return file;
}

async function uploadAndReadCost(page, video, opponent) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await disableGuidanceForCheck(page);
  await page.getByRole('button', { name: /^Games\b/ }).first().click();
  await page.getByRole('button', { name: 'Upload game' }).first().click();
  await openGameDetailsDisclosure(page);
  await page.getByPlaceholder('e.g., Carlsbad SC').fill(opponent);
  await page.locator('input[type="date"]').fill(new Date().toISOString().split('T')[0]);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.locator('form input[type="file"][accept*="video"]').setInputFiles(video);

  const costText = page.getByText(/^Cost: \d+ credit/).first();
  await expect(costText).toBeVisible({ timeout: 30000 });
  const cost = Number((await costText.textContent()).match(/Cost: (\d+)/)[1]);
  expect(cost, 'the dialog shows a positive upload cost').toBeGreaterThan(0);

  const activated = page.waitForResponse(
    (r) => /\/api\/games\/\d+\/activate/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 240000 },
  );
  const submit = page.locator('form button:has-text("Upload game")');
  await expect(submit).toBeEnabled({ timeout: 10000 });
  await submit.click();
  const res = await activated;
  expect(res.status(), 'activate succeeded').toBe(200);
  return cost;
}

test('T16690:C3 - each uploaded game lowers the balance by the cost the dialog showed', async ({ context, page }) => {
  await loginForCheck(context);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const listed = await pageApi(page, '/profiles');
  expect(listed.status, 'GET /profiles').toBe(200);
  const original = (listed.body.profiles || []).find((p) => p.isCurrent) || listed.body.profiles[0];
  const created = [];
  const stamp = Date.now().toString(36);

  try {
    for (const tag of ['a', 'b']) {
      const made = await pageApi(page, '/profiles', {
        method: 'POST',
        body: JSON.stringify({ name: `T16690 ${tag} ${stamp}`, color: '#3b82f6' }),
      });
      expect(made.status, `POST /profiles (${tag})`).toBe(200);
      created.push(made.body.id);

      const before = await balance(page);
      const cost = await uploadAndReadCost(page, uniqueVideo(tag), `T16690 ${tag}`);
      await expect.poll(() => balance(page), {
        message: `profile ${tag}: balance must drop by the dialog's ${cost} credits (was ${before})`,
        timeout: 60000,
      }).toBe(before - cost);
    }
  } finally {
    if (original) await pageApi(page, '/profiles/current', { method: 'PUT', body: JSON.stringify({ profileId: original.id }) });
    for (const id of created) await pageApi(page, `/profiles/${id}`, { method: 'DELETE' });
  }
});
