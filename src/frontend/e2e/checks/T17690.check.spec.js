import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';
import { routeSeekableVideo } from '../helpers/videoRoute.js';

/**
 * T17690: switching the video source in Annotate must not move the playhead.
 *
 * Owner report 2026-11-18: "the playhead changes when I switch the video source in
 * annotate and it shouldn't", and choosing another video did not seem to show it.
 * Owner rule: only a video that covers the playhead moment can be chosen.
 *
 * Neither the dev nor the staging check account holds a game filmed by two cameras,
 * so this logs in as the check account, opens one of its real games, and swaps the
 * game's video list in the /load (and detail) response for synthetic videos: solid
 * colours, so the picture on screen tells which video is drawn. Writes to that game
 * (playhead, preferred camera) are answered locally so the real game is untouched.
 *
 *   overlap game:    video 1 = 0-60 s blue (main camera), video 2 = a red camera
 *                    filmed at the same time, covering 20-50 s (offset 20 s, or a
 *                    Line up offset of 20.37 s).
 *   sequential game: video 1 = 0-30 s green, video 2 = 30-60 s yellow.
 */
test.setTimeout(240000);

const FRAME = 1 / 30;
const COLORS = { blue: [0, 0, 255], red: [255, 0, 0], green: [0, 128, 0], yellow: [255, 255, 0] };
let files;

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 't17690-'));
  const gen = (name, color, dur) => {
    const out = path.join(dir, name);
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=30:d=${dur}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart', out,
    ], { stdio: 'ignore' });
    return out;
  };
  files = {
    blue: gen('blue.mp4', 'blue', 60),
    red: gen('red.mp4', 'red', 30),
    green: gen('green.mp4', 'green', 30),
    yellow: gen('yellow.mp4', 'yellow', 30),
  };
});

function synthVideo(sequence, color, duration, offset) {
  return {
    sequence,
    video_url: `/t17690-video/${color}.mp4`,
    duration,
    video_width: 320,
    video_height: 240,
    offset_seconds: offset,
    recorded_at: null,
    original_filename: `${color}.mp4`,
    preferred: false,
  };
}

const OVERLAP = (angleOffset) => [synthVideo(1, 'blue', 60, 0), synthVideo(2, 'red', 30, angleOffset)];
const SEQUENTIAL = [synthVideo(1, 'green', 30, 0), synthVideo(2, 'yellow', 30, 30)];

async function openSyntheticGame(context, page, videos) {
  await loginForCheck(context);
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  const games = (await res.json()).games || [];
  const target = games.find((g) => g.storage_status === 'active');
  test.skip(!target, '[T17690] no active game to open');
  const id = target.id;

  const rewrite = (game) => ({
    ...game,
    videos,
    annotations: [],
    video_duration: Math.max(...videos.map((v) => v.offset_seconds + v.duration)),
    video_width: 320,
    video_height: 240,
    last_playhead_position: null,
  });
  // Writes to this game go nowhere: the synthetic videos must not touch the real one.
  await page.route(new RegExp(`/api/games/${id}(/|\\?|$)`), async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    return route.fallback();
  });
  await page.route(new RegExp(`/api/games/${id}(\\?|$)`), async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const real = await route.fetch();
    return route.fulfill({ response: real, json: rewrite(await real.json()) });
  });
  await page.route(new RegExp(`/api/games/${id}/load(\\?|$)`), async (route) => {
    const real = await route.fetch();
    const body = await real.json();
    return route.fulfill({ response: real, json: { ...body, game: rewrite(body.game) } });
  });
  for (const color of Object.keys(files)) {
    await routeSeekableVideo(page, new RegExp(`/t17690-video/${color}\\.mp4`), files[color]);
  }

  await openGameInAnnotate(page, id);
  await expect.poll(() => shown(page).then((s) => s?.readyState ?? 0), { timeout: 90000 }).toBeGreaterThanOrEqual(2);
  await disableGuidanceForCheck(page);
}

// The video on screen (the multi-video player keeps a hidden second slot) and the
// colour of its picture.
function shown(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="annotate-video-stage"] video[aria-hidden="false"]');
    if (!el) return null;
    let rgb = null;
    if (el.readyState >= 2 && el.videoWidth) {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const ctx = c.getContext('2d');
      ctx.drawImage(el, 0, 0, 8, 8);
      rgb = Array.from(ctx.getImageData(4, 4, 1, 1).data.slice(0, 3));
    }
    return { src: el.src, time: el.currentTime, readyState: el.readyState, rgb };
  });
}

function colorOf(rgb) {
  if (!rgb) return null;
  let best = null;
  let bestD = Infinity;
  for (const [name, ref] of Object.entries(COLORS)) {
    const d = ref.reduce((s, v, i) => s + (v - rgb[i]) ** 2, 0);
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

// Game time of the picture on screen: the file's own time plus where that video
// sits in the game.
async function gameTime(page, offsets) {
  const s = await shown(page);
  const color = s.src.match(/t17690-video\/(\w+)\.mp4/)?.[1];
  return s.time + offsets[color];
}

async function skipTo(page, seconds) {
  const forward = page.getByTitle('Forward 5 seconds (Right arrow)');
  for (let i = 0; i < seconds / 5; i++) await forward.click({ timeout: 5000 });
}

async function expandSourceBar(page) {
  const trigger = page.getByTestId('source-trigger');
  if (await trigger.isVisible().catch(() => false)) await trigger.click();
  await expect(page.getByTestId('source-seg-1')).toBeVisible({ timeout: 10000 });
}

async function expectShowing(page, color) {
  await expect.poll(async () => {
    const s = await shown(page);
    return s && s.src.includes(`/t17690-video/${color}.mp4`) && s.readyState >= 2 ? colorOf(s.rgb) : null;
  }, { timeout: 60000, message: `the ${color} video is on screen` }).toBe(color);
}

test.describe('T17690 switching source keeps the playhead', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const angleOffset of [20, 20.37]) {
    test(`T17690:C1 cameras filmed at the same time: switching keeps the same moment (angle offset ${angleOffset} s)`, async ({ context, page }) => {
      await openSyntheticGame(context, page, OVERLAP(angleOffset));
      const offsets = { blue: 0, red: angleOffset };
      await expectShowing(page, 'blue');
      await skipTo(page, 30);
      await expect.poll(() => gameTime(page, offsets), { timeout: 30000 }).toBeCloseTo(30, 1);
      await expandSourceBar(page);

      await page.getByTestId('source-seg-2').click();
      await expectShowing(page, 'red');
      expect(Math.abs((await gameTime(page, offsets)) - 30), 'game time after switching to the camera').toBeLessThanOrEqual(FRAME);

      await page.getByTestId('source-seg-1').click();
      await expectShowing(page, 'blue');
      expect(Math.abs((await gameTime(page, offsets)) - 30), 'game time after switching back').toBeLessThanOrEqual(FRAME);

      // Tapping the video already playing does not move the playhead either.
      await page.getByTestId('source-seg-1').click();
      await page.waitForTimeout(1000);
      expect(Math.abs((await gameTime(page, offsets)) - 30), 'game time after tapping the playing video').toBeLessThanOrEqual(FRAME);
    });
  }

  test('T17690:C2 videos one after another: tapping a video does not move the playhead', async ({ context, page }) => {
    await openSyntheticGame(context, page, SEQUENTIAL);
    const offsets = { green: 0, yellow: 30 };
    await expectShowing(page, 'green');
    await skipTo(page, 10);
    await expect.poll(() => gameTime(page, offsets), { timeout: 30000 }).toBeCloseTo(10, 1);
    await expandSourceBar(page);

    for (const seq of [2, 1]) {
      // force: video 2 is drawn disabled (aria-disabled), which Playwright will not
      // click on its own; a parent can still tap it.
      await page.getByTestId(`source-seg-${seq}`).click({ force: true });
      await page.waitForTimeout(1500);
      await expectShowing(page, 'green');
      expect(Math.abs((await gameTime(page, offsets)) - 10), `game time after tapping video ${seq}`).toBeLessThanOrEqual(FRAME);
    }
  });

  test('T17690:C3 a video not covering the playhead is disabled with a reason, and choosable once the playhead is in it', async ({ context, page }) => {
    await openSyntheticGame(context, page, OVERLAP(20));
    const offsets = { blue: 0, red: 20 };
    await expectShowing(page, 'blue');
    await skipTo(page, 10);
    await expect.poll(() => gameTime(page, offsets), { timeout: 30000 }).toBeCloseTo(10, 1);
    await expandSourceBar(page);

    const camera = page.getByTestId('source-seg-2');
    await expect(camera).toHaveAttribute('aria-disabled', 'true');
    await expect(camera).toHaveAttribute('title', /doesn.t cover this part of the game/i);
    await camera.click({ force: true }); // a tap on the disabled video
    await expect(page.getByTestId('source-readout').first()).toContainText(/doesn.t cover this part of the game/i);
    await expect(page.getByTestId('source-seg-1')).toHaveAttribute('aria-pressed', 'true');
    expect(Math.abs((await gameTime(page, offsets)) - 10), 'a disabled tap does not move the playhead').toBeLessThanOrEqual(FRAME);

    // Into the camera's span (20-50 s): it can be chosen now.
    await skipTo(page, 15);
    await expect.poll(() => gameTime(page, offsets), { timeout: 30000 }).toBeCloseTo(25, 1);
    await expect(camera).not.toHaveAttribute('aria-disabled', 'true');
    await camera.click();
    await expectShowing(page, 'red');
    await expect(camera).toHaveAttribute('aria-pressed', 'true');
  });

  test('T17690:C4 owner repro: tapping a different video in the source bar leaves the playhead where it was', async ({ context, page }) => {
    // On master the camera tap outside its span jumped the playhead to the camera's start (20 s).
    await openSyntheticGame(context, page, OVERLAP(20));
    const offsets = { blue: 0, red: 20 };
    await expectShowing(page, 'blue');
    await skipTo(page, 10);
    await expect.poll(() => gameTime(page, offsets), { timeout: 30000 }).toBeCloseTo(10, 1);
    await expandSourceBar(page);
    // force: on the branch the camera is drawn disabled here; the tap must still land.
    await page.getByTestId('source-seg-2').click({ force: true });
    await page.waitForTimeout(1500);
    expect(Math.abs((await gameTime(page, offsets)) - 10), 'game time after the tap').toBeLessThanOrEqual(FRAME);
  });

  test('T17690:C5 choosing a video shows that video and marks it as playing', async ({ context, page }) => {
    await openSyntheticGame(context, page, OVERLAP(20));
    await expectShowing(page, 'blue');
    await skipTo(page, 25);
    await expandSourceBar(page);
    await page.getByTestId('source-seg-2').click();
    await expectShowing(page, 'red');
    await expect(page.getByTestId('source-seg-2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('source-seg-1')).toHaveAttribute('aria-pressed', 'false');
    // Still the chosen video a moment later (no late swap back to the main camera).
    await page.waitForTimeout(2000);
    await expectShowing(page, 'red');

    await page.getByTestId('source-seg-1').click();
    await expectShowing(page, 'blue');
    await expect(page.getByTestId('source-seg-1')).toHaveAttribute('aria-pressed', 'true');
  });
});
