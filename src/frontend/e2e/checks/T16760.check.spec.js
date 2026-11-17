/**
 * T16760 - per-criterion acceptance checks (group checks protocol).
 *
 * In Frame, Preview resizes the stage to the reel's shape. For a portrait (9:16) reel the stage
 * used to take half the column's width (T15650's 50% width floor): at 1440x900 it ran ~890px
 * tall, its lower part and the play controls under the fixed action band ("Sharpen my
 * highlight"). The whole preview and its controls must sit above the band without scrolling.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16760.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

test.setTimeout(300000);

async function listProjects(page) {
  const res = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
  }, checkApi('/projects'));
  expect(res.ok, `GET /projects -> ${res.status}`).toBe(true);
  return Array.isArray(res.body) ? res.body : res.body.projects || [];
}

/** Open Frame on a portrait project (switching a project to Portrait the way a parent does if none is). */
async function openPortraitFrame(page) {
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  const projects = (await listProjects(page)).filter((p) => (p.clip_count || 0) > 0 && !p.has_final_video);
  const portrait = projects.find((p) => p.aspect_ratio === '9:16');
  const project = portrait || projects[0];
  test.skip(!project, '[T16760] no project with a clip in this account');
  await page.goto(`/focus/p/${project.id}`);
  await page.getByTestId('focus-video-stage').waitFor({ timeout: 150000 });
  if (!portrait) {
    const option = page.getByTestId('focus-shape-option-portrait');
    if (await option.isVisible()) await option.click();
    else await page.getByTestId('focus-shape-chip').click();
    const confirm = page.getByTestId('focus-shape-switch-confirm-button');
    if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  }
  await page.getByTestId('framing-preview-toggle').click();
}

/** Bounding boxes of the preview stage, its play control and the fixed action band. */
async function layout(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    };
    return {
      stage: box('[data-testid="focus-video-stage"]'),
      play: box('[data-testid="focus-video-stage"] [data-testid="play-button"]'),
      band: box('[data-testid="action-band"]'),
      scrolled: Math.max(0, ...[...document.querySelectorAll('.overflow-auto')].map((el) => el.scrollTop)),
    };
  });
}

for (const [width, height] of [[1440, 900], [1366, 768]]) {
  test(`T16760:C1 - ${width}x${height}: portrait preview and its controls sit above the action bar without scrolling`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    await loginForCheck(context);
    const page = await context.newPage();
    await openPortraitFrame(page);
    // Wait for the stage to take the portrait shape (taller than wide) and the video to size it.
    await expect.poll(async () => {
      const l = await layout(page);
      return !!(l.stage && l.play && l.band && l.stage.height > l.stage.width && l.stage.width > 100);
    }, { timeout: 60000 }).toBe(true);
    await page.waitForTimeout(1500);
    const l = await layout(page);
    const msg = JSON.stringify(l);
    expect(l.scrolled, `editor scrolled: ${msg}`).toBe(0);
    expect(l.stage.top, `stage starts above the window: ${msg}`).toBeGreaterThanOrEqual(0);
    expect(l.stage.bottom, `preview runs under the action bar: ${msg}`).toBeLessThanOrEqual(l.band.top);
    expect(l.play.bottom, `play control under the action bar: ${msg}`).toBeLessThanOrEqual(l.band.top);
    await context.close();
  });
}
