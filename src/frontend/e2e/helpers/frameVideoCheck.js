import { expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkApi } from './checkAuth';

/**
 * Open Frame on a play the account can load, with the player's video bytes replaced by a
 * fixture (T17500 C2/C4; T17630 moved these here when the first listed play on staging sat on
 * a game still uploading, so Frame showed "Game video still uploading" and no <video>).
 *
 * Fixtures (2 s, 160x90, with AAC sound): T17500-hevc-sound-only.mp4 is HEVC Main10 (an iPhone
 * "High Efficiency" recording); T17500-h264.mp4 is H.264.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HEVC = path.join(__dirname, '..', 'checks', 'fixtures', 'T17500-hevc-sound-only.mp4');
export const H264 = path.join(__dirname, '..', 'checks', 'fixtures', 'T17500-h264.mp4');
export const MESSAGE = /can't show this video's picture, only its sound/;

async function apiJson(page, apiPath) {
  const res = await page.request.get(checkApi(apiPath));
  expect(res.ok(), `${apiPath} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

// A play Frame can load: its playback-url answers 200 (a play on a game still uploading 409s
// and one whose game footage is gone 410s; Frame then shows a panel, never a <video>). The
// /projects list leaves out finished highlights, so candidates come from every play's
// highlight. A play on an expired game comes first: Frame then plays its saved clip.
// API calls only before the first navigation (T16100).
async function framePlayPath(page) {
  const games = await apiJson(page, '/games');
  const gameStatus = new Map((Array.isArray(games) ? games : games.games).map((g) => [g.id, g.storage_status]));
  const plays = (await apiJson(page, '/clips/raw')).filter((c) => c.auto_project_id);
  plays.sort((a, b) => Number(gameStatus.get(b.game_id) === 'expired') - Number(gameStatus.get(a.game_id) === 'expired'));
  for (const play of plays) {
    const projectId = play.auto_project_id;
    const [clip] = await apiJson(page, `/clips/projects/${projectId}/clips`);
    if (!clip) continue;
    const res = await page.request.get(checkApi(`/clips/projects/${projectId}/clips/${clip.id}/playback-url`));
    if (res.ok()) return `/focus/p/${projectId}`;
  }
  throw new Error(`no play Frame can load among ${plays.length} plays with a highlight`);
}

// Serve `file` for every video element request (the player's media fetch, not the app's
// metadata fetch), with the CORS headers a cross-origin storage URL needs.
export async function serveVideoBytes(page, file) {
  const bytes = fs.readFileSync(file);
  await page.route('**/*', (route) => {
    const req = route.request();
    if (req.resourceType() !== 'media') return route.fallback();
    const origin = req.headers().origin;
    return route.fulfill({
      status: 200,
      body: bytes,
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'none',
        ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } : {}),
      },
    });
  });
}

export async function openFrame(page) {
  const p = await framePlayPath(page);
  await page.goto(p);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 }).toBe(p);
  // The player element loaded its metadata (duration known).
  await expect.poll(
    () => page.locator('video').first().evaluate((v) => v.readyState).catch(() => -1),
    { timeout: 60000 },
  ).toBeGreaterThanOrEqual(1);
}
