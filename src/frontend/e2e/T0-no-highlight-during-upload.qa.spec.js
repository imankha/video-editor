import { test, expect } from '@playwright/test';
import { openGameDetailsDisclosure } from './helpers/gameDetails.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * While a game is still uploading, nothing in Annotate may start a highlight
 * (staging 2026-10-17: a 5-star play's "Make highlight now" opened Focus on a
 * source that wasn't stored yet and showed "Source video expired").
 *
 * Drives the REAL upload flow with the R2 part PUTs held (never answered), so the
 * game sits `pending` with a live upload entry, exactly the staging state. Then
 * releases them (fetched from Node so R2's per-origin CORS can't interfere) and
 * checks that the highlight path unlocks without a reload.
 *
 * Empty test-session bypass (X-User-ID + test-login); the throwaway user is
 * deleted afterwards. The video is a copy of the fixture with random bytes
 * appended, so blake3 dedup can't short-circuit the upload.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/wcfc-carlsbad-trimmed.mp4');
// Activation writes a Postgres game_storage_refs row (FK to users), so the throwaway
// id needs a users row: seed it with app.services.auth_db.create_user and pass it in.
const TEST_USER_ID = process.env.UPLOAD_GATE_USER_ID;
let uniqueVideo;

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeAll(() => {
  if (!TEST_USER_ID) throw new Error('UPLOAD_GATE_USER_ID must name a seeded users row (see header)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-gate-'));
  uniqueVideo = path.join(dir, 'upload-gate.mp4');
  fs.copyFileSync(SOURCE_VIDEO, uniqueVideo);
  fs.appendFileSync(uniqueVideo, Buffer.from(Array.from({ length: 1024 * 1024 }, () => Math.floor(Math.random() * 256))));
});

test.afterAll(async ({ request }) => {
  await request.delete('/api/auth/user', { headers: { 'X-User-ID': TEST_USER_ID } }).catch(() => {});
  if (uniqueVideo) fs.rmSync(path.dirname(uniqueVideo), { recursive: true, force: true });
});

test('no highlight path while the game uploads; it unlocks when the upload finishes', async ({ page, baseURL }) => {
  test.setTimeout(300000);
  const origin = new URL(baseURL).origin;
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });

  await page.setExtraHTTPHeaders({ 'X-Test-Mode': 'true', 'X-User-ID': TEST_USER_ID });

  // Hold every R2 request until released; then send it from Node and hand the
  // browser the real response with CORS headers for this dev origin.
  let holding = true;
  const held = [];
  const sendViaNode = async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    const res = await route.fetch({ headers });
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), 'access-control-allow-origin': origin, 'access-control-expose-headers': 'ETag' },
    });
  };
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    if (holding) held.push(route);
    else await sendViaNode(route);
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user_id: TEST_USER_ID, email: 'e2e@test.local' }),
  }));

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Guidance defaults on for a new user; its shade would block the setup clicks.
  const setGuidance = async (on) => {
    const toggle = page.getByTestId('guidance-toggle').first();
    await toggle.waitFor({ timeout: 30000 });
    if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(on), { timeout: 10000 });
  };
  await setGuidance(false);

  // Upload a game.
  await page.locator('button:has-text("Games")').click();
  await page.locator('button:has-text("Upload game")').click();
  await openGameDetailsDisclosure(page);
  await page.getByPlaceholder('e.g., Carlsbad SC').fill('Upload Gate');
  await page.locator('input[type="date"]').fill(new Date().toISOString().split('T')[0]);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.locator('form input[type="file"][accept*="video"]').setInputFiles(uniqueVideo);
  const createGame = page.waitForResponse((r) => r.url().endsWith('/api/games') && r.request().method() === 'POST');
  const submit = page.locator('form button:has-text("Upload game")');
  await expect(submit).toBeEnabled({ timeout: 10000 });
  await submit.click();
  const gameId = (await (await createGame).json()).game_id;
  expect(gameId, 'game record created').toBeTruthy();

  // The bytes are held, so the game must be pending and reported 'uploading' (not 'expired').
  await expect.poll(() => held.length, { message: 'R2 upload traffic is being held', timeout: 60000 }).toBeGreaterThan(0);
  const load = await page.evaluate(async (id) => (await fetch(`/api/games/${id}/load`)).json(), gameId);
  expect(load.game.storage_status).toBe('uploading');

  // Mark a play and rate it 5 stars, then Done.
  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((v) => v.readyState), { timeout: 30000 }).toBeGreaterThanOrEqual(1);
  await video.evaluate((v) => { v.currentTime = Math.min(30, (v.duration || 60) / 2); });
  await page.getByTestId('annotate-mark-play-button').click();
  await page.getByTestId('rating-input').first().getByRole('radio', { name: /^5 stars/ }).click();
  await page.getByTestId('play-editor-done').click();
  // Guidance on now, so the coach's sentence for this state is observable.
  await setGuidance(true);

  // No "Make highlight now" choice card; the editor just closes.
  await expect(page.getByTestId('play-editor-done')).toBeHidden({ timeout: 10000 });
  await expect(page.getByTestId('highlight-choice-now')).toHaveCount(0);

  // The play is selected: both slots locked, no Frame/Spotlight tabs, coach says why.
  for (const o of ['portrait', 'landscape']) {
    const make = page.getByTestId(`annotate-make-highlight-${o}`);
    await expect(make).toBeDisabled({ timeout: 15000 });
    await expect(make).toContainText('Available when your upload finishes');
  }
  await expect(page.getByTestId('mode-framing')).toHaveCount(0);
  await expect(page.getByTestId('floating-coach-host')).toContainText('Highlights unlock once your game finishes uploading', { timeout: 15000 });
  await page.screenshot({ path: test.info().outputPath('1-uploading-locked.png'), fullPage: false });

  // Release the upload; when it activates, the highlight path unlocks without a reload.
  const activated = page.waitForResponse((r) => /\/api\/games\/\d+\/activate/.test(r.url()), { timeout: 240000 });
  holding = false;
  for (const route of held.splice(0)) await sendViaNode(route);
  const act = await activated;
  logs.push(`[activate] ${act.status()} ${await act.text()}`);
  expect(act.status(), 'activation succeeded').toBe(200);

  for (const o of ['portrait', 'landscape']) {
    const make = page.getByTestId(`annotate-make-highlight-${o}`);
    await expect(make).toBeEnabled({ timeout: 30000 });
    await expect(make).not.toContainText('Available when your upload finishes');
  }
  await expect(page.getByTestId('floating-coach-host')).not.toContainText('Highlights unlock', { timeout: 15000 });
  const after = await page.evaluate(async (id) => (await fetch(`/api/games/${id}/load`)).json(), gameId);
  expect(after.game.storage_status).toBe('active');
  await page.screenshot({ path: test.info().outputPath('2-uploaded-unlocked.png'), fullPage: false });

  console.log(logs.join('\n'));
});
