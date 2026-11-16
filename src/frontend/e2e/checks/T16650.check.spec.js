/**
 * T16650 - per-criterion acceptance checks (group checks protocol).
 *
 * On a phone (390x844) the Frame stage has a fixed height and its play controls rendered
 * after the video inside it, so they hung ~50px below the stage box and sat on top of the
 * "rotate your device" hint card right under it. And the "No positions yet..." hint lived
 * inside the 32px crop track, where it wrapped to two lines, spilled out of the track and
 * ran across the playhead line. Fixed by fitting the controls inside the phone stage and
 * showing the empty-timeline hint as a caption above the timeline on the phone.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16650.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

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
  test.skip(!candidate, '[T16650] no project with a clip in this account');
  await page.goto(`/focus/p/${candidate.id}`);
  const stage = page.getByTestId('focus-video-stage');
  await stage.waitFor({ timeout: 90000 });
  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 90000 });
  await expect.poll(
    () => stage.locator('video').first().evaluate((v) => v.readyState).catch(() => 0),
    { timeout: 90000 },
  ).toBeGreaterThanOrEqual(2);
  await page.getByTestId('crop-track').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
}

/** Scroll the page scroller so `el` sits just above the fixed action band. */
async function scrollClear(locator) {
  await locator.evaluate((el) => {
    const sc = el.closest('.flex-1.overflow-auto');
    const band = document.querySelector('[data-testid="action-band"]');
    const bandTop = band ? band.getBoundingClientRect().top : window.innerHeight;
    const r = el.getBoundingClientRect();
    if (sc && r.bottom > bandTop - 8) sc.scrollTop += r.bottom - (bandTop - 8);
  });
}

const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5
  && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

test('T16650:C1 - the rotate hint is fully readable and not behind the video controls', async ({ context, page }) => {
  await loginForCheck(context);
  await openFrame(page);
  const nudge = page.getByTestId('rotate-nudge');
  test.skip(await nudge.count() === 0, '[T16650] the clip already has positions, so no rotate hint shows');
  await scrollClear(nudge);

  const result = await nudge.evaluate((el) => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    const controls = document.querySelector('[data-testid="focus-video-stage"] .controls-container');
    const title = el.querySelector('span span');
    const tr = title.getBoundingClientRect();
    // Every line of the title must be the topmost element where it is drawn.
    const covered = [];
    for (let y = tr.top + 3; y < tr.bottom - 2; y += 6) {
      for (const x of [tr.left + 4, (tr.left + tr.right) / 2, tr.right - 4]) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) covered.push(`${Math.round(x)},${Math.round(y)} -> ${hit ? hit.className || hit.tagName : 'nothing'}`);
      }
    }
    return { nudge: r(el), controls: controls ? r(controls) : null, covered, title: title.textContent };
  });
  expect(result.title).toMatch(/rotate your device/i);
  expect(result.controls, 'video controls are on the screen').not.toBeNull();
  expect(result.nudge.top, `hint top ${Math.round(result.nudge.top)} sits below the controls (bottom ${Math.round(result.controls.bottom)})`)
    .toBeGreaterThanOrEqual(result.controls.bottom - 0.5);
  expect(result.covered, 'nothing is drawn over the hint title').toEqual([]);
});

test('T16650:C2 - the empty-timeline message does not overlap the playhead or the track labels', async ({ context, page }) => {
  await loginForCheck(context);
  await openFrame(page);
  const msg = page.getByText('No positions yet. Drag the box on the video to add one.').locator('visible=true');
  test.skip(await msg.count() === 0, '[T16650] the clip already has positions, so no empty-timeline message shows');
  await expect(msg).toHaveCount(1);
  await scrollClear(page.getByTestId('crop-track'));

  const result = await msg.evaluate((el) => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    const track = document.querySelector('[data-testid="crop-track"]').getBoundingClientRect();
    const block = document.querySelector('[data-testid="focus-timeline-block"]').getBoundingClientRect();
    const playhead = document.querySelector('[data-testid="timeline-playhead"]');
    return {
      msg: r(el),
      playhead: playhead ? r(playhead) : null,
      // The track label column: everything in the timeline block left of the crop track.
      labels: { left: block.left, top: block.top, right: track.left, bottom: block.bottom },
      clipped: el.scrollWidth > el.clientWidth + 1,
    };
  });
  expect(result.playhead, 'the playhead is on the screen').not.toBeNull();
  expect(overlaps(result.msg, result.playhead), `message ${JSON.stringify(result.msg)} overlaps playhead ${JSON.stringify(result.playhead)}`).toBe(false);
  expect(overlaps(result.msg, result.labels), `message ${JSON.stringify(result.msg)} overlaps the track labels ${JSON.stringify(result.labels)}`).toBe(false);
  expect(result.clipped, 'the message is not cut off').toBe(false);
});
