import { expect } from '@playwright/test';
import { disableGuidanceForCheck } from './checkAuth';
import { framePlayPath } from './frameVideoCheck';

/**
 * The T17650 trim-edge scenario, shared by its checks and the staging-check fixes that re-run it
 * (T17720 desktop, T17730 phone/tablet).
 *
 * After a play was split and its last section trimmed, the Undo end trim strip sat over the
 * Delete split button of the split at the trim edge, so the click went to Undo end trim.
 * Owner ruling (2026-11-18): the split that IS a trim edge offers no Delete split; Undo end
 * trim is the one control there and the trim stays until the parent undoes it. Every other
 * split keeps a Delete split that nothing covers.
 *
 * Split the play at about 30% and 70%, trim the last section, then
 *  - Undo end trim is shown and a tap at its centre lands on it,
 *  - every Delete split shown is reachable at its centre and none is at the trim edge,
 *  - deleting the 30% split works and the end stays trimmed, also after a reload (server agrees).
 * The clip is put back (trim undone, splits removed) at the start and end of the scenario.
 */

/** Open Frame at `framePath`, wait for the video, open Trim and slow motion. */
async function openTrim(page, framePath) {
  await page.goto(framePath);
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

/**
 * Press `locator` and wait for THAT gesture's own save (a POST .../actions whose body names one of
 * `actions`), asserting it succeeded. Matching any /actions response is not enough: framing saves
 * queue per clip, so an earlier gesture's response can arrive first, and reloading before the queued
 * save is sent aborts it (the verifier's phone run lost its remove_segment_split to a 409 that way).
 */
async function pressAndSave(page, locator, actions, act = () => press(page, locator)) {
  const saved = page.waitForResponse((r) => {
    if (r.request().method() !== 'POST' || !/\/clips\/.*\/actions/.test(r.url())) return false;
    try { return actions.includes(r.request().postDataJSON()?.action); } catch { return false; }
  }, { timeout: 30000 });
  await act();
  const res = await saved;
  expect(res.ok(), `${actions.join('/')} saved (HTTP ${res.status()})`).toBe(true);
}

/** Put the clip back to one untrimmed section (undo trims, delete splits). */
async function resetClip(page) {
  for (let i = 0; i < 6; i += 1) {
    const untrim = ['set_trim_range', 'clear_trim_range'];
    if (await undoEnd(page).count()) { await pressAndSave(page, undoEnd(page).first(), untrim); }
    else if (await undoStart(page).count()) { await pressAndSave(page, undoStart(page).first(), untrim); }
    else if (await deleteSplits(page).count()) {
      const btn = deleteSplits(page).first();
      await btn.locator('..').hover().catch(() => {});
      await pressAndSave(page, btn, ['remove_segment_split']);
    } else return;
    await page.waitForTimeout(500);
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
  await pressAndSave(page, track, ['split_segment'],
    () => track.click({ position: { x, y: Math.min(10, box.height / 3) } }));
  await expect.poll(
    () => page.getByTestId('speed-track').locator('[title^="Split at"]').count(),
    { message: `split added at ${fraction}`, timeout: 30000 },
  ).toBe(before + 1);
}

export async function runTrimSplitScenario(page, { isTouch = false } = {}) {
  touch = isTouch;
  // A play Frame can load (playback-url 200): on staging the /projects list held only plays on a
  // game still uploading, where Frame shows a panel and never a player (T17720).
  const framePath = await framePlayPath(page, { preferExpired: false });
  await openTrim(page, framePath);
  await resetClip(page);

  await splitAt(page, 0.7);
  await splitAt(page, 0.3);

  // Trim the last section (its Trim section button is the last one).
  const trimButtons = page.getByTestId('speed-track').locator('button[title="Trim section"]');
  await expect(trimButtons).toHaveCount(2, { timeout: 30000 });
  await pressAndSave(page, trimButtons.last(), ['set_trim_range']);
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
  await pressAndSave(page, del, ['remove_segment_split']);
  await expect(deleteSplits(page)).toHaveCount(0, { timeout: 30000 });
  await expect(undoEnd(page)).toHaveCount(1);

  // After a reload the server agrees: still trimmed, the trim edge still has no Delete split.
  await openTrim(page, framePath);
  await expect(undoEnd(page)).toHaveCount(1, { timeout: 30000 });
  await expect(deleteSplits(page)).toHaveCount(0);

  await resetClip(page);
}
