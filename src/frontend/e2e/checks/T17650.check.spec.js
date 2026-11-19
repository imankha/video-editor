/**
 * T17650 - per-criterion acceptance checks (group checks protocol).
 *
 * After a play was split and its last section trimmed, the Undo end trim strip sat over the
 * Delete split button of the split at the trim edge, so the click went to Undo end trim.
 * Owner ruling (2026-11-18): the split that IS a trim edge offers no Delete split; Undo end
 * trim is the one control there and the trim stays until the parent undoes it. Every other
 * split keeps a Delete split that nothing covers.
 *
 * Each check: split the play at about 30% and 70%, trim the last section, then
 *  - Undo end trim is shown and a tap at its centre lands on it,
 *  - every Delete split shown is reachable at its centre and none is at the trim edge,
 *  - deleting the 30% split works and the end stays trimmed, also after a reload (server agrees).
 * The clip is put back (trim undone, splits removed) at the start and end of each check.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17650.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

test.setTimeout(420000);

async function listProjects(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.projects || [];
}

/** Open Frame on a project with a clip, wait for the video, open Trim and slow motion. */
async function openTrim(page, projectId) {
  await page.goto(`/focus/p/${projectId}`);
  const stage = page.getByTestId('focus-video-stage');
  await stage.waitFor({ timeout: 90000 });
  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByText('Connecting...')).toHaveCount(0, { timeout: 90000 });
  await expect.poll(
    () => stage.locator('video').first().evaluate((v) => v.readyState).catch(() => 0),
    { timeout: 90000 },
  ).toBeGreaterThanOrEqual(2);
  await disableGuidanceForCheck(page);
  if (!(await page.getByTestId('speed-track').isVisible())) {
    await page.getByTestId('trim-slowmo-button').click();
  }
  await expect(page.getByTestId('speed-track')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
}

const undoEnd = (page) => page.locator('button[title^="Undo end trim"]');
const undoStart = (page) => page.locator('button[title^="Undo start trim"]');
const deleteSplits = (page) => page.getByTestId('speed-track').locator('button[title="Delete split"]');

/** A press at the element's centre lands on it (nothing drawn on top). */
async function reachable(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });
}

let touch = false;

async function press(page, locator) {
  if (touch) await locator.tap();
  else await locator.click();
}

/** Put the clip back to one untrimmed section (undo trims, delete splits). */
async function resetClip(page) {
  for (let i = 0; i < 6; i += 1) {
    if (await undoEnd(page).count()) { await press(page, undoEnd(page).first()); }
    else if (await undoStart(page).count()) { await press(page, undoStart(page).first()); }
    else if (await deleteSplits(page).count()) {
      const btn = deleteSplits(page).first();
      await btn.locator('..').hover().catch(() => {});
      await press(page, btn);
    } else return;
    await page.waitForTimeout(1200);
  }
  expect(await deleteSplits(page).count(), 'clip reset to one section').toBe(0);
}

/** Split the speed track at a fraction of its usable width (inside the 20px edge padding). */
async function splitAt(page, fraction) {
  const track = page.locator('.segment-track');
  await track.scrollIntoViewIfNeeded();
  const box = await track.boundingBox();
  const x = 20 + (box.width - 40) * fraction;
  const before = await page.getByTestId('speed-track').locator('[title^="Split at"]').count();
  await track.click({ position: { x, y: Math.min(10, box.height / 3) } });
  await expect.poll(
    () => page.getByTestId('speed-track').locator('[title^="Split at"]').count(),
    { message: `split added at ${fraction}`, timeout: 30000 },
  ).toBe(before + 1);
}

async function runScenario(page, { isTouch = false } = {}) {
  touch = isTouch;
  const projects = await listProjects(page);
  const candidate = projects.find((p) => (p.clip_count || 0) > 0);
  test.skip(!candidate, '[T17650] no project with a clip in this account');

  await openTrim(page, candidate.id);
  await resetClip(page);

  await splitAt(page, 0.7);
  await splitAt(page, 0.3);

  // Trim the last section (its Trim section button is the last one).
  const trimButtons = page.getByTestId('speed-track').locator('button[title="Trim section"]');
  await expect(trimButtons).toHaveCount(2, { timeout: 30000 });
  await press(page, trimButtons.last());
  await expect(undoEnd(page)).toHaveCount(1, { timeout: 30000 });
  await page.waitForTimeout(1500);

  // The trim edge shows Undo end trim only, and nothing covers it.
  await expect(undoEnd(page)).toBeVisible();
  expect(await reachable(undoEnd(page)), 'Undo end trim is reachable').toBe(true);

  // Exactly one Delete split (the 30% split) and it is reachable; none at the trim edge.
  await expect(deleteSplits(page)).toHaveCount(1);
  const del = deleteSplits(page).first();
  await del.locator('..').hover().catch(() => {});
  expect(await reachable(del), 'Delete split is reachable (nothing on top)').toBe(true);
  const undoBox = await undoEnd(page).boundingBox();
  const delBox = await del.boundingBox();
  const overlaps = delBox.x < undoBox.x + undoBox.width && undoBox.x < delBox.x + delBox.width
    && delBox.y < undoBox.y + undoBox.height && undoBox.y < delBox.y + delBox.height;
  expect(overlaps, 'Delete split and Undo end trim do not overlap').toBe(false);

  // Deleting that split works and the end stays trimmed.
  const saved = page.waitForResponse((r) => /\/clips\/.*\/actions/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
  await press(page, del);
  expect((await saved).ok(), 'remove split saved').toBe(true);
  await expect(deleteSplits(page)).toHaveCount(0, { timeout: 30000 });
  await expect(undoEnd(page)).toHaveCount(1);

  // After a reload the server agrees: still trimmed, the trim edge still has no Delete split.
  await openTrim(page, candidate.id);
  await expect(undoEnd(page)).toHaveCount(1, { timeout: 30000 });
  await expect(deleteSplits(page)).toHaveCount(0);

  await resetClip(page);
}

test.describe('T17650 @ desktop 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('T17650:C1 - a split can be deleted while the end stays trimmed; the trim edge shows only Undo end trim, uncovered', async ({ context, page }) => {
    await loginForCheck(context);
    await runScenario(page);
  });
});

test.describe('T17650 @ phone 390x844 touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('T17650:C2 phone - the same interaction stays reachable on a phone touch layout', async ({ context, page }) => {
    await loginForCheck(context);
    await runScenario(page, { isTouch: true });
  });
});

test.describe('T17650 @ tablet 820x1180 touch', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('T17650:C2 tablet - the same interaction stays reachable on a tablet touch layout', async ({ context, page }) => {
    await loginForCheck(context);
    await runScenario(page, { isTouch: true });
  });
});
