/**
 * T17230 - per-criterion acceptance checks (group checks protocol).
 *
 * Frame used to show two controls for the same choice once a box position existed: the
 * "Portrait/Landscape" chip above the video and Settings "Aspect ratio". Now the
 * first-run "Where will you share it?" chooser disappears after the first position, and
 * Settings holds the one shape control, labeled "Shape", which asks before switching.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17230.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

test.setTimeout(240000);
test.use({ viewport: { width: 1440, height: 900 } });

// Every visible control that picks Portrait/Landscape, found the way a user sees it
// (a button named by the shape), not by test id.
const shapeButtons = (page) => page.getByRole('button', { name: /^(Portrait|Landscape)\b/ }).filter({ visible: true });

/** A project Frame can edit: its game video still exists (an expired game shows no box).
 *  Projects with a saved box are tried first (same lookup as T16210's check). */
async function findFrameableProject(page) {
  const projectsRes = await page.request.get(checkApi('/projects'));
  expect(projectsRes.ok(), `GET /projects -> ${projectsRes.status()}`).toBeTruthy();
  const body = await projectsRes.json();
  const projects = (Array.isArray(body) ? body : body.projects || []).filter((p) => p.clip_count > 0);
  projects.sort((a, b) => Number(b.has_crop_keyframes) - Number(a.has_crop_keyframes));
  for (const p of projects) {
    const clipsRes = await page.request.get(checkApi(`/clips/projects/${p.id}/clips`));
    if (!clipsRes.ok()) continue;
    const [clip] = await clipsRes.json();
    if (!clip) continue;
    const res = await page.request.get(checkApi(`/clips/projects/${p.id}/clips/${clip.id}/playback-url`));
    if (res.ok()) return p;
  }
  return null;
}

/** Open Frame on a highlight that has a box position. If it has none yet, place the
 *  first one the way a parent does: drag the box (saved by the drag's own POST). */
async function openFrameWithPositions(page) {
  const project = await findFrameableProject(page);
  expect(project, 'a project whose game video Frame can play').toBeTruthy();
  await page.goto(`/focus/p/${project.id}`);
  const cropHandles = page.locator('.crop-handle');
  await cropHandles.first().waitFor({ timeout: 180000 });
  const chooser = page.getByTestId('focus-shape-option-portrait');
  await shapeButtons(page).first().waitFor({ timeout: 60000 });
  if (!(await chooser.isVisible())) return;
  await disableGuidanceForCheck(page);
  const boxes = await cropHandles.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  const cx = (Math.min(...boxes.map((b) => b.x + b.width / 2)) + Math.max(...boxes.map((b) => b.x + b.width / 2))) / 2;
  const cy = (Math.min(...boxes.map((b) => b.y + b.height / 2)) + Math.max(...boxes.map((b) => b.y + b.height / 2))) / 2;
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && /\/actions/.test(r.url()), { timeout: 60000 });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 15, cy, { steps: 5 });
  await page.mouse.move(cx - 30, cy, { steps: 5 });
  await page.mouse.up();
  expect((await saved).ok(), 'the box drag saved the first position').toBeTruthy();
}

test('T17230:C1 - after the first position, Frame shows exactly one shape control, in Settings, labeled "Shape"', async ({ context, page }) => {
  await loginForCheck(context);
  await openFrameWithPositions(page);

  // One Portrait/Landscape pair on the page: the Settings one.
  await expect.poll(() => shapeButtons(page).count(), { timeout: 60000 }).toBe(2);
  await expect(page.getByTestId('focus-shape-choice')).toHaveCount(0);
  await expect(page.getByTestId('focus-shape-chip')).toHaveCount(0);
  await expect(page.getByText('Where will you share it?')).toHaveCount(0);

  const row = page.getByRole('group', { name: /^Shape/ }).locator('xpath=ancestor::div[contains(@class,"justify-between")][1]');
  await expect(row.getByText('Shape', { exact: true })).toBeVisible();
  await expect(row.getByText(/^(Portrait \(9:16\)|Landscape \(16:9\))$/)).toBeVisible();
  await expect(page.getByText('Aspect ratio', { exact: true })).toHaveCount(0);
});

test('T17230:C2 - changing the shape after positions exist asks to confirm', async ({ context, page }) => {
  await loginForCheck(context);
  await openFrameWithPositions(page);

  const current = shapeButtons(page).and(page.locator('[aria-pressed="true"]')).first();
  const other = shapeButtons(page).and(page.locator('[aria-pressed="false"]')).first();
  await other.waitFor({ timeout: 60000 });
  const currentName = await current.textContent();
  const writes = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /aspect-ratio/.test(r.url())) writes.push(r.url()); });
  await other.click();

  const dialog = page.getByTestId('focus-shape-switch-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Switch to (portrait|landscape)\?/);
  // Keep: nothing is written and the shape stays.
  await page.getByTestId('focus-shape-switch-keep').click();
  await expect(dialog).toHaveCount(0);
  await expect(current).toHaveText(currentName);
  expect(writes, 'no shape change was sent').toEqual([]);
});
