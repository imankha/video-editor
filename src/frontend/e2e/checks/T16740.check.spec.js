import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16740: a parent who opens Spotlight from the Finished screen's "Add spotlight" lands
 * at 0:00, where the player boxes drawn come from the first detection that HAS boxes
 * (the 0:00 sample is empty, as on staging project 13). Tapping one of those boxes must
 * tick Tap 1 at once (C1), and a reload must still show Tap 1 ticked (C3).
 *
 * Player detection runs on Modal (off in dev), so detections are added to the REAL
 * overlay-data response at the network edge (same technique as T16210's check): an empty
 * sample at 0:00, then box-bearing samples later. The first box-bearing time is chosen
 * clear of every keyframe the highlight already has, so an earlier run's pick can never
 * make Tap 1 look ticked before this run's tap.
 */
test.setTimeout(300000);

const DESKTOP = { width: 1440, height: 900 };

async function finishedHighlight(page) {
  const response = await page.request.get(checkApi('/downloads'));
  expect(response.ok(), `GET /downloads -> ${response.status()}`).toBeTruthy();
  const { downloads } = await response.json();
  const editable = downloads.find((d) => d.project_id && !(d.clip_count > 1));
  expect(editable, 'the account has a finished single-play highlight').toBeTruthy();
  return editable;
}

/** Adds detections to every overlay-data response for this project; returns the first
 *  box-bearing detection time once the first response has been seen. */
async function injectDetections(page, projectId) {
  const state = { firstTime: null };
  await page.route(`**/api/export/projects/${projectId}/overlay-data`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const duration = data.video_duration
      || Math.max(...(data.highlights_data || []).map((r) => r.end_time || 0), 0) || 4;
    if (state.firstTime == null) {
      // Clear of every stored keyframe (1/3 s apart at least; the guide counts 5 frames).
      const taken = (data.highlights_data || []).flatMap((r) => (r.keyframes || []).map((k) => (
        k.time ?? (k.frame != null ? k.frame / 30 : null))).filter((t) => t != null));
      for (let frame = 20; frame < Math.floor(duration * 30) - 10; frame += 11) {
        const t = frame / 30;
        if (taken.every((k) => Math.abs(k - t) > 1 / 3)) { state.firstTime = +t.toFixed(3); break; }
      }
      expect(state.firstTime, 'a detection time clear of the stored keyframes').not.toBeNull();
    }
    const box = { x: 640, y: 360, width: 120, height: 240, confidence: 0.9 };
    const t1 = state.firstTime;
    const t2 = +Math.min(duration - 0.1, t1 + 1).toFixed(3);
    const detections = [
      { timestamp: 0, frame: 0, boxes: [] },
      { timestamp: t1, frame: Math.round(t1 * 30), boxes: [box, { ...box, x: 300 }] },
      { timestamp: t2, frame: Math.round(t2 * 30), boxes: [box, { ...box, x: 900 }] },
    ];
    data.detections_data = { videoWidth: 1280, videoHeight: 720, fps: 30, detections };
    for (const region of data.highlights_data || []) {
      region.detections = detections.filter((d) => d.timestamp >= (region.start_time ?? 0) - 0.01
        && d.timestamp <= (region.end_time ?? duration) + 0.01);
      region.videoWidth = 1280;
      region.videoHeight = 720;
      region.fps = 30;
    }
    await route.fulfill({ response, json: data });
  });
  return state;
}

test('T16740:C1 opening Spotlight from Finished and tapping a drawn box at once ticks Tap 1; T16740:C3 a reload still shows it ticked', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await loginForCheck(page);
  const highlight = await finishedHighlight(page);
  await injectDetections(page, highlight.project_id);

  await page.goto(`/home/published/${highlight.id}`);
  await disableGuidanceForCheck(page);
  const edit = page.getByTitle('Edit highlight').first();
  await expect(edit).toBeVisible({ timeout: 60000 });
  await edit.click();
  const spotlight = page.getByTestId('finished-redo-spotlight');
  await expect(spotlight).toBeVisible({ timeout: 60000 });
  await spotlight.click();
  await page.waitForURL(/\/overlay\/p\//, { timeout: 60000 });

  // Not picked yet: the panel asks for the athlete and a box is drawn.
  await expect(page.getByText('Tap your athlete to add a spotlight')).toBeVisible({ timeout: 120000 });
  const box = page.locator('svg rect.cursor-pointer').first();
  await expect(box).toBeVisible({ timeout: 60000 });
  // Staging lands this path at 0:00 (the dev stack's faster load parks on marker 1
  // first); restart to 0:00 so the tap happens where the parent's did. The boxes still
  // drawn there are marker 1's (the 0:00 sample is empty).
  await page.getByTitle('Restart (go to beginning)').click();
  await expect(page.getByText('00:00:00.000')).toBeVisible({ timeout: 30000 });
  await expect(box).toBeVisible();

  // The parent taps the box: the tap is saved and Tap 1 ticks.
  const saved = page.waitForResponse((r) => r.url().includes('/overlay/actions')
    && r.request().method() === 'POST' && r.ok(), { timeout: 60000 });
  await box.click();
  await saved;
  const step1 = page.getByTestId('pick-guide-checklist-step-1');
  await expect(step1).toHaveClass(/text-green-300/, { timeout: 30000 });

  // C3: a reload shows the same ticked state.
  await page.reload();
  const step1AfterReload = page.getByTestId('pick-guide-checklist-step-1');
  await expect(step1AfterReload).toBeVisible({ timeout: 120000 });
  await expect(step1AfterReload).toHaveClass(/text-green-300/, { timeout: 30000 });
});
