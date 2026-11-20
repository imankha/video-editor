import { expect } from '@playwright/test';
import { checkApi, disableGuidanceForCheck } from './checkAuth';
import { pressAndSave, resetClip, splitAt } from './trimSplitScenario';

/**
 * The "Trim and slow motion" toggle in Frame (T17860), shared by its checks and by T17890, which
 * re-runs T17860:C2 on a play whose stored cut list is partial ({trimRange: null}).
 */

export const trimButton = (page) => page.getByTestId('trim-slowmo-button');

/** Open Frame on a play that loads, wait for the video, guidance off, track closed. */
export async function openFrame(page, framePath) {
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
  await expect(trimButton(page)).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('speed-track')).toHaveCount(0);
}

const iconClass = (locator) => locator.locator('svg').first().getAttribute('class');

export async function expectClosed(page) {
  const btn = trimButton(page);
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(btn).toHaveAttribute('aria-label', 'Trim and slow motion');
  await expect(btn).toContainText('Trim and slow motion');
  expect(await iconClass(btn)).toMatch(/lucide-scissors/);
  await expect(btn).not.toHaveAttribute('aria-pressed', /.*/);
}

export async function expectOpen(page) {
  const btn = trimButton(page);
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(btn).toHaveAttribute('aria-label', 'Done trimming');
  await expect(btn).toContainText('Done trimming');
  expect(await iconClass(btn)).toMatch(/lucide-check/);
  await expect(btn).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(page.getByTestId('speed-track')).toBeVisible({ timeout: 30000 });
}

/**
 * T17860:C2 on the play at `framePath`: with the track open, split, trim the last section and
 * slow the first to 0.5x (each saved); tapping Done trimming hides the track, restores the closed
 * button and sends no save; the server's cut list and the highlight length are unchanged, and
 * reopening shows the same edits. The play is put back afterwards.
 */
export async function closeKeepsEdits(page, framePath) {
  const projectId = framePath.split('/').pop();
  const clipSegments = async () => {
    const res = await page.request.get(checkApi(`/clips/projects/${projectId}/clips`));
    expect(res.ok()).toBeTruthy();
    const [clip] = await res.json();
    return JSON.stringify(clip.segments_data ?? null);
  };
  // The highlight's output length (post-trim, post-speed) as the Frame page shows it.
  const lengthChip = page.getByTestId('output-length-chip').locator('visible=true').first();
  const highlightLength = async () => (await lengthChip.textContent()).trim();
  const slowSpeed = page.getByTestId('speed-track').getByText('0.5x slow motion');
  await openFrame(page, framePath);
  await trimButton(page).click();
  await expectOpen(page);
  await resetClip(page);
  const normalSpeed = page.getByTestId('speed-track').locator('button[title^="Set speed to 1x"]');
  while (await normalSpeed.count()) await pressAndSave(page, normalSpeed.first(), ['set_segment_speed']);

  // Edits while open: split, then trim the last section (shortens the highlight).
  await splitAt(page, 0.5);
  const trimSection = page.getByTestId('speed-track').locator('button[title="Trim section"]');
  await expect(trimSection).toHaveCount(2, { timeout: 30000 });
  await pressAndSave(page, trimSection.last(), ['set_trim_range']);
  await expect(page.locator('button[title^="Undo end trim"]')).toHaveCount(1, { timeout: 30000 });
  // ...and slow the first section to 0.5x (lengthens the highlight).
  const trimmedLength = await highlightLength();
  await pressAndSave(page, page.getByTestId('speed-track').locator('button[title="Set speed to 0.5x"]').first(), ['set_segment_speed']);
  await expect(slowSpeed).toHaveCount(1, { timeout: 30000 });
  await expect.poll(highlightLength, { message: 'the 0.5x section lengthens the highlight', timeout: 10000 }).not.toBe(trimmedLength);
  await page.waitForTimeout(1500);
  const edited = await clipSegments();
  const editedLength = await highlightLength();
  expect(Object.values(JSON.parse(edited)?.segmentSpeeds ?? {}), 'the server holds the 0.5x speed').toContain(0.5);

  // Closing is not an edit: no save is sent and the track hides.
  const saves = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/clips\/.*\/actions/.test(r.url())) saves.push(r.url()); });
  await trimButton(page).click();
  await expect(page.getByTestId('speed-track')).toHaveCount(0, { timeout: 30000 });
  await expectClosed(page);
  await page.waitForTimeout(2000);
  expect(saves, 'closing the track sends no save').toEqual([]);
  expect(await clipSegments(), 'the trim, split and speed are unchanged by closing').toBe(edited);
  expect(await highlightLength(), 'the highlight length is unchanged by closing').toBe(editedLength);

  // Reopening shows the same trim still applied.
  await trimButton(page).click();
  await expectOpen(page);
  await expect(page.locator('button[title^="Undo end trim"]')).toHaveCount(1, { timeout: 30000 });
  await expect(slowSpeed, 'the 0.5x speed is still applied after reopening').toHaveCount(1);
  expect(await highlightLength()).toBe(editedLength);
  await pressAndSave(page, normalSpeed.first(), ['set_segment_speed']);
  await resetClip(page);
}
