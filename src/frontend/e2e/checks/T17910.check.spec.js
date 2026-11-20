/**
 * T17910 - per-criterion acceptance checks (group checks protocol).
 *
 * Frame's bar reads in working order (owner ruling 2026-11-19): "Trim and slow motion",
 * "Preview", then "Sharpen!" (wand icon, second line "Uses N credits", a wider gap before it).
 * While on, the toggles read "Close trimming" and "Close preview"; on a computer an idle line
 * beside the buttons names Sharpen! as the finish. Nothing in the bar moves or resizes when a
 * toggle is tapped. On a computer there is no "Where will you share it?" chooser (Settings has
 * Shape), so the coach has five steps; phones keep it and six steps.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17910.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { checkApi, disableGuidanceForCheck, loginForCheck } from '../helpers/checkAuth';
import { pressAndSave, resetClip, splitAt } from '../helpers/trimSplitScenario';

test.setTimeout(300000);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const LANDSCAPE_PHONE = { width: 812, height: 334 };
const HINT = 'Trim and Preview are optional. When your athlete stays in the box, tap Sharpen!';

async function apiJson(page, apiPath) {
  const res = await page.request.get(checkApi(apiPath));
  expect(res.ok(), `${apiPath} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

/**
 * A play Frame can load whose framing has never been sharpened, so the band's CTA is
 * "Sharpen!" (a sharpened one shows "Watch highlight" in that slot). The
 * /projects list holds the unfinished ones (finished highlights are left out of it). Ids
 * come from the API; API calls only before the first navigation.
 */
async function sharpenPlayPath(page) {
  const body = await apiJson(page, '/projects');
  const projects = (Array.isArray(body) ? body : body.projects || [])
    .filter((p) => (p.clip_count || 0) > 0 && !p.has_working_video);
  for (const project of projects) {
    const [clip] = await apiJson(page, `/clips/projects/${project.id}/clips`);
    if (!clip) continue;
    const res = await page.request.get(checkApi(`/clips/projects/${project.id}/clips/${clip.id}/playback-url`));
    if (res.ok()) return `/focus/p/${project.id}`;
  }
  throw new Error(`no unsharpened play Frame can load among ${projects.length} unfinished projects`);
}

async function waitForVideo(page) {
  const stage = page.getByTestId('focus-video-stage');
  await stage.waitFor({ timeout: 90000 });
  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByText('Connecting...')).toHaveCount(0, { timeout: 90000 });
  await expect.poll(
    () => stage.locator('video').first().evaluate((v) => v.readyState).catch(() => 0),
    { timeout: 90000 },
  ).toBeGreaterThanOrEqual(2);
}

async function openFrame(context, page) {
  await loginForCheck(context);
  await page.goto(await sharpenPlayPath(page));
  await waitForVideo(page);
  await disableGuidanceForCheck(page);
  await expect(trim(page)).toBeVisible({ timeout: 30000 });
  await expect(sharpen(page)).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1000);
}

const trim = (page) => page.getByTestId('trim-slowmo-button');
const preview = (page) => page.getByTestId('framing-preview-toggle');
const sharpen = (page) => page.getByTestId('action-band').getByRole('button', { name: /^Sharpen!/ });
const iconClass = (locator) => locator.locator('svg').first().getAttribute('class');


const costLine = (page) => sharpen(page).getByTestId('cta-cost-line');
const creditsOnButton = async (page) => {
  const m = /^Uses (\d+) credits?$/.exec((await costLine(page).textContent()).trim());
  return m ? Number(m[1]) : null;
};
/** The bar's output length ("Length: m:ss"), in whole seconds: 1 credit per second (T9480). */
async function lengthSeconds(page) {
  const text = await page.locator('[data-testid="output-length-chip"]:visible').first().textContent();
  const [, m, sec] = /(\d+):(\d\d)/.exec(text);
  return Number(m) * 60 + Number(sec);
}

/**
 * A playable highlight with no box positions yet (`has_crop_keyframes` false), so Frame offers
 * the shape step. Made from a play when none exists (the request "Make highlight" sends);
 * `made` is then deleted by the test.
 */
async function positionlessPlay(page) {
  const body = await apiJson(page, '/projects');
  const projects = (Array.isArray(body) ? body : body.projects || [])
    .filter((p) => (p.clip_count || 0) > 0 && !p.has_crop_keyframes && !p.has_working_video);
  for (const project of projects) {
    const [clip] = await apiJson(page, `/clips/projects/${project.id}/clips`);
    if (!clip) continue;
    const res = await page.request.get(checkApi(`/clips/projects/${project.id}/clips/${clip.id}/playback-url`));
    if (res.ok()) return { path: `/focus/p/${project.id}`, made: null };
  }
  const games = await apiJson(page, '/games');
  for (const game of games.games || games) {
    if (game.storage_status !== 'active') continue;
    const play = ((await apiJson(page, `/games/${game.id}`)).annotations || []).find((a) => a.auto_project_id == null);
    if (!play) continue;
    const res = await page.request.put(checkApi(`/clips/raw/${play.id}`), { data: { create_project: true } });
    expect(res.ok(), `PUT /clips/raw/${play.id} create_project -> ${res.status()}`).toBeTruthy();
    const { project_id: id } = await res.json();
    return { path: `/focus/p/${id}`, made: id };
  }
  throw new Error('no playable highlight without box positions, and no play to make one from');
}

async function deleteProject(page, id) {
  if (id == null) return;
  const status = await page.evaluate(async (url) => (await fetch(url, { method: 'DELETE', credentials: 'include' })).status,
    checkApi(`/projects/${id}`));
  expect([200, 404], `DELETE /projects/${id}`).toContain(status);
}

/** Log in with Guidance ON (set before the first navigation) and open a positionless play. */
async function openPositionlessWithCoach(context, page) {
  await loginForCheck(context);
  const res = await page.request.put(checkApi('/settings'), { data: { guidance: { coachEnabled: true } } });
  expect(res.ok(), `PUT /settings guidance on -> ${res.status()}`).toBeTruthy();
  const play = await positionlessPlay(page);
  await page.goto(play.path);
  return play;
}

async function stableBox(page, locator) {
  await page.waitForTimeout(1500);
  return locator.boundingBox();
}

function expectSameBox(a, b, what) {
  for (const k of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(a[k] - b[k]), `${what}: Sharpen ${k} unchanged`).toBeLessThanOrEqual(0.5);
  }
}

test.describe('at 1440 wide', () => {
  test.use({ viewport: DESKTOP });

  test('T17910:C1 - at 1440 wide the buttons read Trim and slow motion, Preview, Sharpen! left to right, and Tab reaches them in that order', async ({ context, page }) => {
    await openFrame(context, page);
    const [t, p, s] = [await trim(page).boundingBox(), await preview(page).boundingBox(), await sharpen(page).boundingBox()];
    await expect(trim(page)).toContainText('Trim and slow motion');
    await expect(preview(page)).toContainText('Preview');
    await expect(sharpen(page)).toHaveAttribute('aria-label', 'Sharpen!');
    await expect(sharpen(page)).toContainText('Sharpen!');
    expect(t.x + t.width <= p.x + 0.5, 'Trim is left of Preview').toBe(true);
    expect(p.x + p.width <= s.x + 0.5, 'Preview is left of Sharpen').toBe(true);
    expect(Math.abs(t.y - s.y) < 2 && Math.abs(p.y - s.y) < 2, 'one row').toBe(true);

    // Keyboard: from Trim, Tab goes to Preview, then to Sharpen.
    await trim(page).focus();
    await page.keyboard.press('Tab');
    await expect(preview(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sharpen(page)).toBeFocused();
  });

  test('T17910:C2 - tapping Trim and slow motion reads Close trimming with scissors and aria-expanded, shows the track, and tapping again restores it; no Done trimming', async ({ context, page }) => {
    await openFrame(context, page);
    await expect(page.getByTestId('speed-track')).toHaveCount(0);
    await trim(page).click();
    await expect(trim(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(trim(page)).toHaveAttribute('aria-label', 'Close trimming');
    await expect(trim(page)).toContainText('Close trimming');
    expect(await iconClass(trim(page))).toMatch(/lucide-scissors/);
    expect(await iconClass(trim(page))).not.toMatch(/lucide-check/);
    await expect(page.getByTestId('speed-track')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Done trimming')).toHaveCount(0);
    await trim(page).click();
    await expect(trim(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(trim(page)).toContainText('Trim and slow motion');
    await expect(page.getByTestId('speed-track')).toHaveCount(0, { timeout: 30000 });
    await expect(page.getByText('Done trimming')).toHaveCount(0);
  });

  test('T17910:C3 - tapping Preview reads Close preview, tapping it returns to the box and reads Preview; no Back to full video', async ({ context, page }) => {
    await openFrame(context, page);
    await expect(page.getByTestId('crop-rect')).toBeVisible({ timeout: 60000 });
    await preview(page).click();
    await expect(preview(page)).toContainText('Close preview', { timeout: 30000 });
    await expect(preview(page)).toHaveAttribute('aria-label', 'Close preview');
    await expect(page.getByTestId('crop-rect')).toHaveCount(0, { timeout: 60000 });
    await expect(page.getByText('Back to full video')).toHaveCount(0);
    await preview(page).click();
    await expect(page.getByTestId('crop-rect')).toBeVisible({ timeout: 60000 });
    await expect(preview(page)).toHaveAttribute('aria-label', 'Preview');
    await expect(page.getByText('Back to full video')).toHaveCount(0);
  });

  test('T17910:C4 - at 1440 wide with nothing in progress the idle line shows to the left of the buttons', async ({ context, page }) => {
    await openFrame(context, page);
    const hint = page.getByTestId('action-band').getByText(HINT, { exact: true });
    await expect(hint).toBeVisible({ timeout: 30000 });
    const h = await hint.boundingBox();
    const t = await trim(page).boundingBox();
    expect(h.x + h.width <= t.x + 0.5, 'the line sits left of Trim').toBe(true);
  });

  test('T17910:C5 - at 1440 wide Sharpen! shows the wand, not the download arrow or the sparkles', async ({ context, page }) => {
    await openFrame(context, page);
    const cls = await iconClass(sharpen(page));
    expect(cls).toMatch(/lucide-wand/);
    expect(cls).not.toMatch(/lucide-download|lucide-sparkles/);
  });

  test('T17910:C6 - at 1440 wide Sharpen keeps its position and size with Trim open or closed and Preview on or off', async ({ context, page }) => {
    await openFrame(context, page);
    const base = await stableBox(page, sharpen(page));
    await trim(page).click();
    await expect(page.getByTestId('speed-track')).toBeVisible({ timeout: 30000 });
    expectSameBox(await stableBox(page, sharpen(page)), base, 'Trim open');
    await trim(page).click();
    await expect(page.getByTestId('speed-track')).toHaveCount(0, { timeout: 30000 });
    await preview(page).click();
    await expect(preview(page)).toContainText('Close preview', { timeout: 30000 });
    expectSameBox(await stableBox(page, sharpen(page)), base, 'Preview on');
    await preview(page).click();
    await expect(preview(page)).toHaveAttribute('aria-label', 'Preview');
    expectSameBox(await stableBox(page, sharpen(page)), base, 'Preview off');
  });

  test('T17910:C8 - Sharpen! carries "Uses N credits" with N the bar\'s estimate; a trim changes N and not the button\'s size', async ({ context, page }) => {
    await openFrame(context, page);
    await expect(page.getByText(/Sharpen my highlight/)).toHaveCount(0);
    await expect(sharpen(page)).toHaveAttribute('aria-label', 'Sharpen!');
    await expect(costLine(page)).toHaveText(/^Uses \d+ credits?$/, { timeout: 30000 });
    const fontSize = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await fontSize(costLine(page)), 'the second line is smaller than the name')
      .toBeLessThan(await fontSize(sharpen(page).getByText('Sharpen!', { exact: true })));

    await trim(page).click();
    await expect(page.getByTestId('speed-track')).toBeVisible({ timeout: 30000 });
    await resetClip(page);
    try {
      await page.waitForTimeout(1000);
      const before = await creditsOnButton(page);
      expect(before, 'N on the button').toBe(await lengthSeconds(page));
      const box = await stableBox(page, sharpen(page));

      await splitAt(page, 0.5);
      const trimButtons = page.getByTestId('speed-track').locator('button[title="Trim section"]');
      await expect(trimButtons).toHaveCount(2, { timeout: 30000 });
      await pressAndSave(page, trimButtons.last(), ['set_trim_range']);
      await expect.poll(() => creditsOnButton(page), { message: 'N drops after the trim', timeout: 30000 }).toBeLessThan(before);
      expect(await creditsOnButton(page), 'N is still the bar\'s estimate').toBe(await lengthSeconds(page));
      const after = await stableBox(page, sharpen(page));
      expect(Math.abs(after.width - box.width), 'width unchanged').toBeLessThanOrEqual(0.5);
      expect(Math.abs(after.height - box.height), 'height unchanged').toBeLessThanOrEqual(0.5);
    } finally {
      await resetClip(page);
    }
  });

  test('T17910:C9 - the gap before Sharpen! is at least twice the gap between Trim and Preview', async ({ context, page }) => {
    await openFrame(context, page);
    const [t, p, s] = [await trim(page).boundingBox(), await preview(page).boundingBox(), await sharpen(page).boundingBox()];
    const small = p.x - (t.x + t.width);
    const big = s.x - (p.x + p.width);
    expect(small, 'Trim and Preview have a gap').toBeGreaterThan(0);
    expect(big, `gap before Sharpen! (${big}px) >= 2 x Trim-Preview (${small}px)`).toBeGreaterThanOrEqual(2 * small - 0.5);
    const c = await page.getByTestId('sharpen-step-chevron').boundingBox();
    expect(c.x >= p.x + p.width - 0.5 && c.x + c.width <= s.x + 0.5, 'the chevron sits in that gap').toBe(true);
  });

  test('T17910:C10 - at 1440 wide a play with no box positions shows no shape chooser and the coach starts at the drag step, "Step 1 of 5"; Settings Shape still switches', async ({ context, page }) => {
    const play = await openPositionlessWithCoach(context, page);
    try {
      await waitForVideo(page);
      await expect(page.getByTestId('framing-guide-step')).toHaveText('Step 1 of 5', { timeout: 60000 });
      await expect(page.getByTestId('framing-guide-text')).toHaveText('Drag the box onto your athlete. Your highlight shows what’s inside it.');
      await expect(page.getByTestId('focus-shape-choice')).toHaveCount(0);
      await expect(page.getByText('Where will you share it?')).toHaveCount(0);

      // The Settings Shape row switches the shape (no positions yet, so no confirm). Guidance off
      // first: its modal shade (by design) takes every click outside the step's cutouts.
      await disableGuidanceForCheck(page);
      // While editing the stage shows the whole source video; the crop box carries the shape.
      const box = page.getByTestId('crop-rect');
      const wide = async () => { const r = await box.boundingBox(); return r.width > r.height; };
      const portrait = page.getByTestId('shape-setting-portrait');
      const landscape = page.getByTestId('shape-setting-landscape');
      await expect(portrait).toBeVisible({ timeout: 30000 });
      const wasPortrait = (await portrait.getAttribute('aria-pressed')) === 'true';
      const [other, back] = wasPortrait ? [landscape, portrait] : [portrait, landscape];
      await other.click();
      await expect(other).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
      await expect.poll(wide, { message: 'the box switched shape', timeout: 30000 }).toBe(wasPortrait);
      await back.click();
      await expect(back).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
      await expect.poll(wide, { message: 'and back', timeout: 30000 }).toBe(!wasPortrait);
    } finally {
      await deleteProject(page, play.made);
    }
  });
});

test.describe('at 390 wide', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('T17910:C1 - at 390 wide Trim and Preview share one row and Sharpen! is full width directly beneath', async ({ context, page }) => {
    await openFrame(context, page);
    const [t, p, s] = [await trim(page).boundingBox(), await preview(page).boundingBox(), await sharpen(page).boundingBox()];
    expect(Math.abs(t.y - p.y) < 1, 'Trim and Preview share a row').toBe(true);
    expect(t.x < p.x, 'Trim is left of Preview').toBe(true);
    expect(t.y + t.height <= s.y + 0.5, 'Sharpen is beneath them').toBe(true);
    expect(s.y - (t.y + t.height) < 24, 'directly beneath (no row between)').toBe(true);
    expect(Math.abs(s.x - t.x) < 1 && Math.abs((s.x + s.width) - (p.x + p.width)) < 1, 'Sharpen spans both columns').toBe(true);
  });

  test('T17910:C4 - at 390 wide the idle line is not shown', async ({ context, page }) => {
    await openFrame(context, page);
    await expect(page.getByText(HINT, { exact: true })).toBeHidden();
  });

  test('T17910:C6 - at 390 wide Sharpen keeps its position and size with Trim open or closed and Preview on or off', async ({ context, page }) => {
    await openFrame(context, page);
    const base = await stableBox(page, sharpen(page));
    await trim(page).click();
    await expect(page.getByTestId('speed-track')).toBeVisible({ timeout: 30000 });
    expectSameBox(await stableBox(page, sharpen(page)), base, 'Trim open');
    await trim(page).click();
    await expect(page.getByTestId('speed-track')).toHaveCount(0, { timeout: 30000 });
    await preview(page).click();
    await expect(preview(page)).toContainText('Close preview', { timeout: 30000 });
    expectSameBox(await stableBox(page, sharpen(page)), base, 'Preview on');
    await preview(page).click();
    await expect(preview(page)).toHaveAttribute('aria-label', 'Preview');
    expectSameBox(await stableBox(page, sharpen(page)), base, 'Preview off');
  });
  test('T17910:C10 - at 390 wide a play with no box positions still shows the shape chooser and the coach\'s first step points at it, "Step 1 of 6"', async ({ context, page }) => {
    const play = await openPositionlessWithCoach(context, page);
    try {
      await waitForVideo(page);
      await expect(page.getByTestId('focus-shape-choice')).toBeVisible({ timeout: 60000 });
      await expect(page.getByTestId('framing-guide-step')).toHaveText('Step 1 of 6', { timeout: 60000 });
      await expect(page.getByTestId('framing-guide-text')).toHaveText('Where will you share it? Portrait for Instagram and TikTok, landscape for YouTube and coaches.');
    } finally {
      await deleteProject(page, play.made);
    }
  });
});

test.describe('at 1280x800', () => {
  test.use({ viewport: LAPTOP });

  test('T17910:C6 - at 1280x800 the video, play controls and crop track fit above the bar without scrolling', async ({ context, page }) => {
    await openFrame(context, page);
    await page.getByTestId('crop-track').waitFor({ timeout: 60000 });
    const scrollTop = () => page.getByTestId('focus-video-stage').evaluate((el) => el.closest('.flex-1.overflow-auto')?.scrollTop ?? null);
    expect(await scrollTop(), 'not scrolled').toBe(0);
    for (const id of ['focus-video-stage', 'play-button', 'crop-track']) {
      await expect.poll(() => page.getByTestId(id).first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        const band = document.querySelector('[data-testid="action-band"]').getBoundingClientRect();
        if (r.height === 0) return 'no height';
        if (r.top < -0.5) return `top ${Math.round(r.top)} above the viewport`;
        if (r.bottom > band.top + 0.5) return `bottom ${Math.round(r.bottom)} under the bar (top ${Math.round(band.top)})`;
        return 'ok';
      }), { message: `${id} fits above the bar`, timeout: 30000 }).toBe('ok');
    }
  });
});

test.describe('landscape phone rail', () => {
  test.use({ viewport: LANDSCAPE_PHONE, hasTouch: true, isMobile: true });

  test('T17910:C5 - in the landscape phone rail Sharpen! shows the wand, not the download arrow or the sparkles', async ({ context, page }) => {
    await loginForCheck(context);
    await page.goto(await sharpenPlayPath(page));
    const rail = page.getByTestId('cockpit-actions');
    await expect(rail).toBeVisible({ timeout: 90000 });
    const cta = rail.getByTestId('cockpit-cta-ring').getByRole('button');
    await expect(cta).toHaveAttribute('title', 'Sharpen!', { timeout: 60000 });
    await expect(cta).toHaveText('Sharpen!');
    await expect(cta).toBeVisible({ timeout: 60000 });
    const cls = await iconClass(cta);
    expect(cls).toMatch(/lucide-wand/);
    expect(cls).not.toMatch(/lucide-download|lucide-sparkles/);
  });
  test('T17910:C10 - on a landscape phone a play with no box positions still shows the shape chooser and the coach\'s first step points at it, "Step 1 of 6"', async ({ context, page }) => {
    const play = await openPositionlessWithCoach(context, page);
    try {
      await expect(page.getByTestId('cockpit-actions')).toBeVisible({ timeout: 90000 });
      const gotIt = page.getByRole('button', { name: 'Got it' });
      if (await gotIt.waitFor({ timeout: 10000 }).then(() => true, () => false)) await gotIt.click();
      await expect(page.getByTestId('focus-shape-choice')).toBeVisible({ timeout: 60000 });
      const coach = page.getByTestId('cockpit-guide');
      await expect(coach).toContainText('Step 1 of 6', { timeout: 60000 });
      await expect(page.getByTestId('cockpit-guide-text')).toHaveText('Where will you share it? Portrait for Instagram and TikTok, landscape for YouTube and coaches.');
    } finally {
      await deleteProject(page, play.made);
    }
  });
});
