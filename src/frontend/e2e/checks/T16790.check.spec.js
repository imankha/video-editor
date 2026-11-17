import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16790: hovering a player box in Spotlight shows "Tap to add spotlight". For a box at
 * the left or right edge of a portrait highlight the label must stay fully inside the
 * video (it used to be centred on the box at a fixed 100 px and got cut off).
 *
 * Player detection runs on Modal (off in dev), so detections are added to the REAL
 * overlay-data response at the network edge (same technique as T16740's check): every
 * sample carries one box hugging the left edge and one hugging the right edge. Boxes are
 * in the working video's own pixels, so the page is loaded once to read that size and
 * then reloaded with the boxes.
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

async function injectEdgeDetections(page, projectId, size) {
  await page.route(`**/api/export/projects/${projectId}/overlay-data`, async (route) => {
    const response = await route.fetch();
    if (!size.width) { await route.fulfill({ response }); return; }
    const data = await response.json();
    const { width: VIDEO_W, height: VIDEO_H } = size;
    const duration = data.video_duration
      || Math.max(...(data.highlights_data || []).map((r) => r.end_time || 0), 0) || 4;
    const box = { y: VIDEO_H / 2, width: VIDEO_W / 20, height: VIDEO_H / 6, confidence: 0.9 };
    const boxes = [{ ...box, x: box.width / 2 }, { ...box, x: VIDEO_W - box.width / 2 }];
    const detections = [];
    for (let frame = 0; frame < Math.floor(duration * 30); frame += 10) {
      detections.push({ timestamp: +(frame / 30).toFixed(3), frame, boxes });
    }
    data.detections_data = { videoWidth: VIDEO_W, videoHeight: VIDEO_H, fps: 30, detections };
    for (const region of data.highlights_data || []) {
      region.detections = detections.filter((d) => d.timestamp >= (region.start_time ?? 0) - 0.01
        && d.timestamp <= (region.end_time ?? duration) + 0.01);
      region.videoWidth = VIDEO_W;
      region.videoHeight = VIDEO_H;
      region.fps = 30;
    }
    await route.fulfill({ response, json: data });
  });
}

/** The on-screen rectangle the video picture occupies (object-fit: contain). */
async function videoPictureRect(page) {
  return page.locator('video').first().evaluate((v) => {
    const r = v.getBoundingClientRect();
    const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const w = v.videoWidth * scale;
    const h = v.videoHeight * scale;
    return { left: r.left + (r.width - w) / 2, right: r.left + (r.width + w) / 2,
      top: r.top + (r.height - h) / 2, bottom: r.top + (r.height + h) / 2 };
  });
}

test('T16790:C1 the hover label stays fully inside the video for boxes at both edges', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await loginForCheck(page);
  const highlight = await finishedHighlight(page);
  const size = { width: 0, height: 0 };
  await injectEdgeDetections(page, highlight.project_id, size);

  await page.goto(`/home/published/${highlight.id}`);
  await disableGuidanceForCheck(page);
  const edit = page.getByTitle('Edit highlight').first();
  await expect(edit).toBeVisible({ timeout: 60000 });
  await edit.click();
  const spotlight = page.getByTestId('finished-redo-spotlight');
  await expect(spotlight).toBeVisible({ timeout: 60000 });
  await spotlight.click();
  await page.waitForURL(/\/overlay\/p\//, { timeout: 60000 });

  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((v) => v.videoWidth), { timeout: 120000 }).toBeGreaterThan(0);
  Object.assign(size, await video.evaluate((v) => ({ width: v.videoWidth, height: v.videoHeight })));
  await page.reload();

  const boxes = page.locator('svg rect.cursor-pointer');
  await expect(boxes).toHaveCount(2, { timeout: 120000 });
  await expect.poll(() => video.evaluate((v) => v.videoWidth), { timeout: 60000 }).toBeGreaterThan(0);

  for (const side of ['left', 'right']) {
    const index = side === 'left' ? 0 : 1;
    await boxes.nth(index).hover();
    const label = page.locator('svg text', { hasText: 'Tap to add spotlight' });
    await expect(label).toBeVisible({ timeout: 10000 });
    const background = page.locator('svg rect[fill="rgba(0, 0, 0, 0.8)"]');
    const picture = await videoPictureRect(page);
    for (const [name, part] of [['label text', label], ['label background', background]]) {
      const b = await part.boundingBox();
      expect(b, `${side} ${name} has a box`).toBeTruthy();
      expect(b.x, `${side} ${name} left edge inside video (${picture.left})`).toBeGreaterThanOrEqual(picture.left - 0.5);
      expect(b.x + b.width, `${side} ${name} right edge inside video (${picture.right})`).toBeLessThanOrEqual(picture.right + 0.5);
    }
    // The background covers the whole text.
    const t = await label.boundingBox();
    const bg = await background.boundingBox();
    expect(t.x, `${side} text starts inside its background`).toBeGreaterThanOrEqual(bg.x);
    expect(t.x + t.width, `${side} text ends inside its background`).toBeLessThanOrEqual(bg.x + bg.width);
    await page.mouse.move(5, 5);
    await expect(label).toBeHidden();
  }
});
