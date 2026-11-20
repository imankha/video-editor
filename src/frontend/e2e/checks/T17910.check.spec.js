/**
 * T17910 - per-criterion acceptance checks (group checks protocol).
 *
 * Frame's bar reads in working order (owner ruling 2026-11-19): "Trim and slow motion",
 * "Preview", then "Sharpen my highlight" (wand icon). While on, the toggles read "Close
 * trimming" and "Close preview"; on a computer an idle line beside the buttons names Sharpen as
 * the finish. Nothing in the bar moves or resizes when a toggle is tapped.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17910.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { checkApi, disableGuidanceForCheck, loginForCheck } from '../helpers/checkAuth';

test.setTimeout(300000);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const LANDSCAPE_PHONE = { width: 812, height: 334 };
const HINT = 'Trim and Preview are optional. When your athlete stays in the box, tap Sharpen my highlight.';

async function apiJson(page, apiPath) {
  const res = await page.request.get(checkApi(apiPath));
  expect(res.ok(), `${apiPath} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

/**
 * A play Frame can load whose framing has never been sharpened, so the band's CTA is
 * "Sharpen my highlight" (a sharpened one shows "Watch highlight" in that slot). The
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
const sharpen = (page) => page.getByTestId('action-band').getByRole('button', { name: /^Sharpen my highlight/ });
const iconClass = (locator) => locator.locator('svg').first().getAttribute('class');

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

  test('T17910:C1 - at 1440 wide the buttons read Trim and slow motion, Preview, Sharpen my highlight left to right, and Tab reaches them in that order', async ({ context, page }) => {
    await openFrame(context, page);
    const [t, p, s] = [await trim(page).boundingBox(), await preview(page).boundingBox(), await sharpen(page).boundingBox()];
    await expect(trim(page)).toContainText('Trim and slow motion');
    await expect(preview(page)).toContainText('Preview');
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

  test('T17910:C5 - at 1440 wide Sharpen my highlight shows the wand, not the download arrow or the sparkles', async ({ context, page }) => {
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
});

test.describe('at 390 wide', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('T17910:C1 - at 390 wide Trim and Preview share one row and Sharpen my highlight is full width directly beneath', async ({ context, page }) => {
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

  test('T17910:C5 - in the landscape phone rail Sharpen my highlight shows the wand, not the download arrow or the sparkles', async ({ context, page }) => {
    await loginForCheck(context);
    await page.goto(await sharpenPlayPath(page));
    const rail = page.getByTestId('cockpit-actions');
    await expect(rail).toBeVisible({ timeout: 90000 });
    // The compact CTA's label is two stacked spans ("Sharpen my" / "highlight").
    const cta = rail.getByTestId('cockpit-cta-ring').getByRole('button');
    await expect(cta).toHaveAttribute('title', 'Sharpen my highlight', { timeout: 60000 });
    await expect(cta).toBeVisible({ timeout: 60000 });
    const cls = await iconClass(cta);
    expect(cls).toMatch(/lucide-wand/);
    expect(cls).not.toMatch(/lucide-download|lucide-sparkles/);
  });
});
