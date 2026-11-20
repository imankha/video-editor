import { expect } from '@playwright/test';
import { checkApi } from './checkAuth';

/**
 * sharpenWhilePreviewing - the T16750 flow, shared by the T16750 and T16810 checks:
 * a parent makes a new highlight, presses Preview in Frame, and presses "Sharpen!"
 * while the preview plays, until the Finished panel opens over Frame.
 *
 * T16810: the highlight is made fresh each run, the way a parent does it (Annotate, a play,
 * "Make highlight", which always creates a NEW draft) on a game whose video is ready.
 * Reusing an existing draft ran out once every draft was sharpened, and on staging it
 * picked a draft on a game stuck uploading (no frame rate), where Frame shows no Sharpen
 * button.
 */

async function pageApi(page, path) {
  const res = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
  }, checkApi(path));
  expect(res.ok, `GET ${path} -> ${res.status}`).toBe(true);
  return res.body;
}

function projectIdFromUrl(page) {
  const m = new URL(page.url()).pathname.match(/^\/focus\/p\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Wait for the app to finish loading. On a cold stack the first session request can time out
 * and the loading screen shows "Still connecting" with a Retry button (T16400), which waits for
 * a press: press it, as a parent would, until the app is up.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function waitForAppLoaded(page, timeout = 150000) {
  const deadline = Date.now() + timeout;
  while (await page.locator('#preloader').count()) {
    expect(Date.now(), 'app still on the loading screen').toBeLessThan(deadline);
    const retry = page.locator('#preloader-retry');
    if (await retry.isVisible()) await retry.click();
    await page.waitForTimeout(1000);
  }
}

/** Every <video> on the page: whether it sits in the Frame editor's stage, paused, and its time. */
async function videos(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="focus-video-stage"]');
    return [...document.querySelectorAll('video')].map((v) => ({
      inFrame: !!stage && stage.contains(v),
      paused: v.paused,
      muted: v.muted,
      time: v.currentTime,
      size: `${v.videoWidth}x${v.videoHeight}`,
    }));
  });
}

/**
 * Sample every <video> for ~7 s. The preview loops a ~6 s range and briefly pauses at the wrap,
 * so a single read can miss a video that is playing; any sample with a playing Frame video fails.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function frameVideoStaysPaused(page) {
  const samples = [];
  for (let i = 0; i < 8; i++) {
    if (i) await page.waitForTimeout(1000);
    samples.push(await videos(page));
  }
  const frame = samples.map((all) => all.filter((v) => v.inFrame));
  const times = new Set(frame.flat().map((v) => v.time));
  const ok = frame.every((f) => f.length > 0 && f.every((v) => v.paused)) && times.size === 1;
  return { ok, samples: samples.map((all) => all.map((v) => `${v.inFrame ? 'frame' : 'other'} ${v.size} paused=${v.paused} t=${v.time.toFixed(2)}`)) };
}

/**
 * From a logged-in, loaded page with Guidance off: make a new highlight the way a parent does
 * (Annotate on a game whose video is ready, a play, "Make highlight": always a NEW portrait
 * draft) and wait for Frame to show its stage. Returns false when the account has no game with
 * a ready video and a play. Shared with the T16760/T16820 portrait-layout checks (T16820).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
export async function makeNewHighlight(page) {
  const body = await pageApi(page, '/games');
  const game = (body.games || body).find((g) => g.status === 'ready' && g.clip_count > 0);
  if (!game) return false;
  await page.goto(`/annotate/g/${game.id}`);
  await waitForAppLoaded(page);
  const clipRows = page.getByTestId('clip-row');
  await expect.poll(() => clipRows.count(), { timeout: 180000 }).toBeGreaterThan(0);
  await clipRows.first().click({ timeout: 30000 });
  const make = page.getByTestId('annotate-make-highlight');
  await expect(make).toBeEnabled({ timeout: 120000 });
  await make.click();
  await expect.poll(() => projectIdFromUrl(page), { timeout: 180000 }).not.toBeNull();
  await waitForAppLoaded(page);
  await page.getByTestId('focus-video-stage').waitFor({ timeout: 150000 });
  return true;
}

/**
 * From a logged-in, loaded page with Guidance off: make a new highlight, Preview it, Sharpen it
 * while it plays, and wait for the Finished panel. Returns false (the caller skips loudly) when
 * the account has no game with a ready video and a play.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
export async function sharpenNewHighlightWhilePreviewing(page) {
  if (!(await makeNewHighlight(page))) return false;
  const sharpen = page.getByRole('button', { name: 'Sharpen!' }).first();
  await expect(sharpen).toBeEnabled({ timeout: 60000 });

  // Preview plays the highlight in the Frame editor's own video.
  await page.getByTestId('framing-preview-toggle').click();
  await expect.poll(async () => (await videos(page)).some((v) => v.inFrame && !v.paused), { timeout: 60000 }).toBe(true);

  // Sharpen while it is still playing.
  await sharpen.click();
  const confirm = page.getByTestId('focus-box-confirm');
  if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await confirm.getByRole('button', { name: 'Sharpen!' }).click();
  }
  await page.getByTestId('focus-publish-action-bar').waitFor({ timeout: 480000 });
  return true;
}
