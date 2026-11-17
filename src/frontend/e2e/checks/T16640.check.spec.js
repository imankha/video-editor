/**
 * T16640 - per-criterion acceptance checks (group checks protocol).
 *
 * On a 1280x800 laptop the Frame action band (Sharpen / Trim and slow motion / Preview,
 * ~233px of stacked tall cards plus a cost row) sat over the bottom of the video and the
 * timeline, so the parent had to scroll to reach the play controls and the crop track.
 * Fixed by making the layout fit the screen height on desktop (lg, >=1024px wide): the band
 * is one row of short cards with the cost beside them, the "Where will you share it?"
 * chooser is one row, and the stage height reserves the real space the chrome around it
 * takes. Phone layout (<1024px) is untouched.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16640.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);

async function listProjects(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.projects || [];
}

/** Open Frame on a project with a clip and wait until the stage video has loaded. */
async function openFrame(page) {
  const projects = await listProjects(page);
  const candidate = projects.find((p) => (p.clip_count || 0) > 0);
  test.skip(!candidate, '[T16640] no project with a clip in this account');
  await page.goto(`/focus/p/${candidate.id}`);
  const stage = page.getByTestId('focus-video-stage');
  await stage.waitFor({ timeout: 90000 });
  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByText('Connecting...')).toHaveCount(0, { timeout: 90000 });
  await expect.poll(
    () => stage.locator('video').first().evaluate((v) => v.readyState).catch(() => 0),
    { timeout: 90000 },
  ).toBeGreaterThanOrEqual(2);
  await page.getByTestId('crop-track').waitFor({ timeout: 60000 });
  // Let the stage settle at its loaded size.
  await page.waitForTimeout(1500);
}

async function editorScrollTop(page) {
  return page.getByTestId('focus-video-stage').evaluate((el) => {
    const scroller = el.closest('.flex-1.overflow-auto');
    return scroller ? scroller.scrollTop : null;
  });
}

/**
 * Where `testId`'s box sits relative to the viewport and the action band:
 * 'ok' when fully inside the viewport and fully above the band, else a description.
 */
async function placement(page, testId) {
  return page.getByTestId(testId).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const band = document.querySelector('[data-testid="action-band"]').getBoundingClientRect();
    if (r.height === 0) return `${el.dataset.testid} has no height`;
    if (r.top < -0.5) return `${el.dataset.testid} top ${Math.round(r.top)} is above the viewport`;
    if (r.bottom > band.top + 0.5) return `${el.dataset.testid} bottom ${Math.round(r.bottom)} is under the action band (top ${Math.round(band.top)})`;
    return 'ok';
  });
}

/** Nothing sits on top of the element: a tap at its centre lands on it. */
async function notCovered(page, testId) {
  return page.getByTestId(testId).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });
}

test.describe('T16640 @ desktop 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('T16640:C1 - the whole video, the play controls and the crop timeline show without scrolling and clear of the bar', async ({ context, page }) => {
    await loginForCheck(context);
    await openFrame(page);
    expect(await editorScrollTop(page), 'the screen has not been scrolled').toBe(0);

    for (const id of ['focus-video-stage', 'play-button', 'crop-track']) {
      await expect.poll(() => placement(page, id), { message: `${id} shown without scrolling`, timeout: 30000 }).toBe('ok');
    }
    for (const id of ['play-button', 'crop-track']) {
      await expect.poll(() => notCovered(page, id), { message: `${id} is not covered`, timeout: 30000 }).toBe(true);
    }
    expect(await editorScrollTop(page), 'still not scrolled').toBe(0);
  });

  test('T16640:C2 - in Trim mode the Normal speed track is fully visible', async ({ context, page }) => {
    await loginForCheck(context);
    await openFrame(page);

    await page.getByTestId('trim-slowmo-button').click();
    const speed = page.getByTestId('speed-track');
    await expect(speed).toBeVisible({ timeout: 30000 });
    await expect(speed.getByText('Normal speed').first()).toBeVisible();
    await expect.poll(() => placement(page, 'speed-track'), { message: 'speed track fully visible', timeout: 30000 }).toBe('ok');
    await expect.poll(() => notCovered(page, 'speed-track'), { message: 'speed track not covered', timeout: 30000 }).toBe(true);
  });
});

test.describe('T16640 @ phone 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('T16640:C3 - the phone layout is unchanged and nothing newly overlaps', async ({ context, page }) => {
    await loginForCheck(context);
    await openFrame(page);

    const box = async (id) => page.getByTestId(id).first().boundingBox();

    // Band shape on the phone: Sharpen full width on top, Trim and Preview side by side
    // under it, each a short row card with its description hidden; cost line below.
    const band = await box('action-band');
    const sharpen = await page.getByTestId('action-band-above').locator('button').first().boundingBox();
    const trim = await box('trim-slowmo-button');
    const preview = await box('framing-preview-toggle');
    expect(sharpen.y + sharpen.height <= trim.y + 0.5, 'Sharpen sits above Trim').toBe(true);
    expect(Math.abs(trim.y - preview.y) < 1, 'Trim and Preview share a row').toBe(true);
    expect(sharpen.width > trim.width * 1.8, 'Sharpen spans the full width').toBe(true);
    expect(trim.height <= 60, `Trim is a short row card (h=${trim.height})`).toBe(true);
    await expect(page.getByTestId('trim-slowmo-button').locator('[data-cta-desc]')).toBeHidden();
    expect(band.y + band.height <= 844.5 && band.y >= 0, 'band inside the viewport').toBe(true);
    const cost = await box('export-credit-estimate');
    if (cost) expect(cost.y >= trim.y + trim.height - 0.5, 'cost line sits under the cards').toBe(true);

    // The column stacks without overlap: chooser, then stage, then timeline.
    const shape = await box('focus-shape-choice');
    const stage = await box('focus-video-stage');
    const timeline = await box('trim-guide-scope');
    expect(shape.y + shape.height <= stage.y + 0.5, 'chooser above the stage').toBe(true);
    expect(stage.y + stage.height <= timeline.y + 0.5, 'stage above the timeline').toBe(true);
    expect(stage.width >= 330, `stage keeps the full phone width (w=${stage.width})`).toBe(true);

    // Everything above the band can still be scrolled clear of it.
    await page.getByTestId('focus-video-stage').evaluate((el) => {
      const sc = el.closest('.flex-1.overflow-auto'); sc.scrollTop = sc.scrollHeight;
    });
    await expect.poll(() => placement(page, 'crop-track'), { message: 'crop track reachable above the band', timeout: 30000 }).toBe('ok');
  });
});
