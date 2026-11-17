/**
 * T16750 - per-criterion acceptance checks (group checks protocol).
 *
 * A parent presses Preview in Frame and then "Sharpen my highlight" while the preview plays.
 * When the Finished panel opens over Frame, the Frame editor's video must stop: it used to keep
 * looping, unmuted, behind the Finished player. Closing Finished must not start it again.
 *
 * One login and ONE real sharpen in beforeAll, shared by both criteria.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16750.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

let context;
let page;
let sharpened = false;

async function listProjects() {
  const res = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
  }, checkApi('/projects'));
  expect(res.ok, `GET /projects -> ${res.status}`).toBe(true);
  return Array.isArray(res.body) ? res.body : res.body.projects || [];
}

/** Every <video> on the page: whether it sits in the Frame editor's stage, paused, and its time. */
async function videos() {
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
 */
async function frameVideoStaysPaused() {
  const samples = [];
  for (let i = 0; i < 8; i++) {
    if (i) await page.waitForTimeout(1000);
    samples.push(await videos());
  }
  const frame = samples.map((all) => all.filter((v) => v.inFrame));
  const times = new Set(frame.flat().map((v) => v.time));
  const ok = frame.every((f) => f.length > 0 && f.every((v) => v.paused)) && times.size === 1;
  return { ok, samples: samples.map((all) => all.map((v) => `${v.inFrame ? 'frame' : 'other'} ${v.size} paused=${v.paused} t=${v.time.toFixed(2)}`)) };
}

/**
 * Wait for the app to finish loading. On a cold stack the first session request can time out
 * and the loading screen shows "Still connecting" with a Retry button (T16400), which waits for
 * a press: press it, as a parent would, until the app is up.
 */
async function waitForAppLoaded(timeout = 150000) {
  const deadline = Date.now() + timeout;
  while (await page.locator('#preloader').count()) {
    expect(Date.now(), 'app still on the loading screen').toBeLessThan(deadline);
    const retry = page.locator('#preloader-retry');
    if (await retry.isVisible()) await retry.click();
    await page.waitForTimeout(1000);
  }
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(600000);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginForCheck(context);
  page = await context.newPage();

  await page.goto('/home');
  await waitForAppLoaded();
  await disableGuidanceForCheck(page);
  const projects = await listProjects();
  const draft = projects.find((p) => (p.clip_count || 0) === 1 && !p.has_working_video && !p.has_final_video);
  if (!draft) return; // each test skips loudly below
  await page.goto(`/focus/p/${draft.id}`);
  await waitForAppLoaded();
  await page.getByTestId('focus-video-stage').waitFor({ timeout: 150000 });
  const sharpen = page.getByRole('button', { name: 'Sharpen my highlight' }).first();
  await expect(sharpen).toBeEnabled({ timeout: 60000 });

  // Preview plays the highlight in the Frame editor's own video.
  await page.getByTestId('framing-preview-toggle').click();
  await expect.poll(async () => (await videos()).some((v) => v.inFrame && !v.paused), { timeout: 60000 }).toBe(true);

  // Sharpen while it is still playing.
  await sharpen.click();
  const confirm = page.getByTestId('focus-box-confirm');
  if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await confirm.getByRole('button', { name: 'Sharpen my highlight' }).click();
  }
  await page.getByTestId('focus-publish-action-bar').waitFor({ timeout: 480000 });
  sharpened = true;
});

test.afterAll(async () => {
  await context?.close();
});

test('T16750:C1 - with Preview playing, Sharpen, then Finished opens: the Frame video is paused', async () => {
  test.skip(!sharpened, '[T16750] no single-clip draft that has not been sharpened yet in this account');
  await expect(page.getByTestId('focus-publish-action-bar')).toBeVisible();
  const state = await frameVideoStaysPaused();
  expect(state.ok, `Frame video playing behind Finished: ${JSON.stringify(state.samples)}`).toBe(true);
});

test('T16750:C2 - closing Finished back to Frame does not auto-resume the Frame video', async () => {
  test.skip(!sharpened, '[T16750] the setup sharpened no highlight');
  await page.getByTestId('player-close').click();
  await expect(page.getByTestId('focus-publish-action-bar')).toHaveCount(0, { timeout: 30000 });
  const state = await frameVideoStaysPaused();
  expect(state.ok, `Frame video resumed after closing Finished: ${JSON.stringify(state.samples)}`).toBe(true);
});
