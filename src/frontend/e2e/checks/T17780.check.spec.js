/**
 * T17780 - per-criterion acceptance check (group checks protocol).
 *
 * Spotlight's timeline "Delete text" control (text-delete-region-N, TextLayer.jsx) measured
 * 20 x 20 on a phone. On a real touch context (hasTouch + isMobile -> pointer: coarse) at each
 * size the QA layout scan listed, the control's HIT AREA must be at least 44 x 44 (C1), and that
 * hit area must not overlap the text block itself, its trim levers, or any other control, nor
 * cover the block's label (C2).
 *
 * The hit area is measured the way a finger meets it: document.elementFromPoint over a 44 x 44
 * grid centred on the button must land on the button at every point. That counts a transparent
 * hit-pad (the RegionLayer T15600 pattern) the same as a bigger visible chip.
 *
 * Setup: opens Spotlight on the account's first project that already has a sharpened (working)
 * video. On a deployed target it never sharpens one (T17880): a sharpen at check time spent the
 * staging gate account's credits on every run until the account could not pay for one, so with no
 * such project the check fails at once and names the fixture to seed (FIXTURE-CONTRACT.md item 2a).
 * A dev stack run's fresh preset account has none, so there it sharpens a draft first (framedProject).
 * Each test asserts the credit balance is what it was after setup. If that project has no text, the
 * check taps "Add text" (a real user gesture) and deletes that region again with the control under
 * test, so the account is left as it was found.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17780.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { waitForRealVideoReady } from '../helpers/videoRoute';
import { sharpenableDraft } from '../helpers/returnAfterSharpen';

test.setTimeout(120000);

const SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
];
const DELETE_SELECTOR = '[data-testid^="text-delete-region-"]';

/**
 * Scroll the first delete control into view and on past the sticky action band at the bottom, as a
 * parent does (on a 390px-tall landscape phone the band covers the lower 230px), then read its hit geometry in the page.
 */
async function measureDelete(page) {
  await page.waitForTimeout(200); // let the resize layout settle
  await page.evaluate((sel) => {
    const button = document.querySelector(sel);
    button.scrollIntoView({ block: 'center', inline: 'center' });
    // Still under a sticky/fixed band? Scroll the button's scroll container on until it clears.
    for (let i = 0; i < 3; i++) {
      const r = button.getBoundingClientRect();
      const padBottom = r.top + r.height / 2 + 22;
      const under = document.elementFromPoint(r.left + r.width / 2, padBottom - 1);
      if (!under || under === button || button.contains(under)) return;
      let band = under;
      while (band && !['sticky', 'fixed'].includes(getComputedStyle(band).position)) band = band.parentElement;
      if (!band) return;
      let scroller = button.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight
        && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      (scroller || document.scrollingElement).scrollTop += padBottom - band.getBoundingClientRect().top + 8;
    }
  }, DELETE_SELECTOR);
  await page.waitForTimeout(200); // let the scroll settle
  return page.evaluate((sel) => {
    const button = document.querySelector(sel);
    const r = button.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const half = 22;
    const missed = [];
    // Sample a 44 x 44 square centred on the button, 1px inside its edges.
    for (let dx = -half + 1; dx <= half - 1; dx += 3) {
      for (let dy = -half + 1; dy <= half - 1; dy += 3) {
        const el = document.elementFromPoint(cx + dx, cy + dy);
        if (!el || !(el === button || button.contains(el))) {
          missed.push(`(${dx},${dy})->${el ? el.tagName + (el.dataset.testid ? `#${el.dataset.testid}` : '') : 'none'}`);
        }
      }
    }
    // C2: the 44 x 44 hit square vs every other control drawn in the timeline.
    const hit = { left: cx - half, right: cx + half, top: cy - half, bottom: cy + half };
    const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5
      && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const others = [...document.querySelectorAll(
      'button, a, input, select, [role="slider"], [role="button"], .lever-handle',
    )].filter((el) => el !== button && !button.contains(el) && !el.contains(button));
    const overlapping = others
      .filter((el) => {
        const o = el.getBoundingClientRect();
        if (o.width === 0 || o.height === 0) return false;
        return overlaps(hit, o);
      })
      .map((el) => el.dataset.testid || el.getAttribute('title') || el.tagName);
    // The text block's label must still be the thing under its own centre.
    const regionIndex = button.dataset.testid.replace('text-delete-region-', '');
    const body = document.querySelector(`[data-testid="text-block-body-${regionIndex}"]`);
    const b = body.getBoundingClientRect();
    const underBody = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return {
      width: r.width,
      height: r.height,
      missed,
      overlapping,
      bodyStillOnTop: underBody === body || body.contains(underBody),
    };
  }, DELETE_SELECTOR);
}

let s = null; // { context, page, created, balanceBefore } shared by both criteria

/** GET an API path from inside the page (staging 401s page.request after the app's own session, T16100). */
async function pageApi(page, path) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, checkApi(path));
}

async function listProjects(page) {
  const res = await pageApi(page, '/projects');
  expect(res.ok, `GET /projects -> ${res.status}`).toBe(true);
  return Array.isArray(res.body) ? res.body : res.body.projects || [];
}

async function creditBalance(page) {
  const res = await pageApi(page, '/credits');
  expect(res.ok, `GET /credits -> ${res.status}`).toBe(true);
  return res.body.balance;
}

/**
 * A project Spotlight can open: one that already has a sharpened video. On a deployed target it never
 * sharpens one (T17880: that spent the gate account's credits on every run). A dev stack run gets a
 * fresh throwaway preset account with no such project, so there it sharpens a single-play draft on a
 * ready game the way a parent does (T16525's setup; sharpenableDraft avoids drafts on a game still
 * uploading, T17810).
 */
async function framedProject(page) {
  const projects = await listProjects(page);
  const framed = projects.find((p) => p.has_working_video);
  if (framed || process.env.E2E_BASE_URL) {
    expect(framed, 'a project with a sharpened video (FIXTURE-CONTRACT.md item 2a); seed the gate account, '
      + 'this check does not spend credits sharpening one').toBeTruthy();
    return framed;
  }
  const draft = await sharpenableDraft(page);
  expect(draft, 'a single-play draft on a ready game to sharpen (dev stack)').toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/focus/p/${draft.id}`);
  await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });
  const sharpen = page.getByRole('button', { name: 'Sharpen my highlight' }).first();
  await expect(sharpen).toBeEnabled({ timeout: 60000 });
  await sharpen.click();
  // An untouched box asks once (T14830); continuing sharpens as usual.
  const confirm = page.getByTestId('focus-box-confirm');
  if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await confirm.getByRole('button', { name: 'Sharpen my highlight' }).click();
  }
  await page.getByTestId('focus-publish-action-bar').waitFor({ timeout: 480000 });
  await page.setViewportSize(SIZES[0]);
  return draft;
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(600000);
  const context = await browser.newContext({ viewport: SIZES[0], hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await loginForCheck(page);
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  const project = await framedProject(page);
  // Read after setup: on a deployed target setup spends nothing, on the dev stack its sharpen is the fixture.
  const balanceBefore = await creditBalance(page);
  // Spotlight restores its saved text from overlay-data; a tap before that lands is overwritten.
  const restored = page.waitForResponse((r) => r.url().includes('/overlay-data') && r.ok(), { timeout: 90000 });
  await page.goto(`/overlay/p/${project.id}`);
  await page.getByTestId('overlay-video-stage').waitFor({ timeout: 90000 });
  await restored;
  const video = await waitForRealVideoReady(page, { minReadyState: 2, timeout: 60000 });
  expect(video.ready, video.reason).toBe(true);
  await disableGuidanceForCheck(page);

  let created = false;
  if ((await page.locator(DELETE_SELECTOR).count()) === 0) {
    // The text lane appears once the draft has text: add one the way a parent does, then close
    // the phone settings panel that opens with it (Escape is its keyboard close).
    const saved = page.waitForResponse((r) => /\/overlay\/actions/.test(r.url()) && r.request().method() === 'POST', { timeout: 60000 });
    await page.getByTestId('overlay-add-text-button').click();
    created = true;
    await saved;
    await page.keyboard.press('Escape');
  }
  await expect(page.locator(DELETE_SELECTOR).first()).toBeVisible({ timeout: 60000 });
  s = { context, page, created, balanceBefore };
});

test.afterAll(async () => {
  if (!s) return;
  if (s.created) {
    // Leave the account as found: delete the added region with the control under test.
    await s.page.setViewportSize(SIZES[0]);
    const before = await s.page.locator(DELETE_SELECTOR).count();
    await s.page.locator(DELETE_SELECTOR).first().click();
    await expect.poll(() => s.page.locator(DELETE_SELECTOR).count(), { timeout: 60000 }).toBe(before - 1);
  }
  await s.context.close();
});

test('T17780:C1 Delete text control is at least 44 x 44 on touch at every listed size', async () => {
  for (const size of SIZES) {
    await s.page.setViewportSize(size);
    const m = await measureDelete(s.page);
    expect(m.missed, `${size.width}x${size.height}: 44x44 hit area around the ${m.width}x${m.height} button`).toEqual([]);
  }
  expect(await creditBalance(s.page), 'credit balance (T17880: the check spends nothing)').toBe(s.balanceBefore);
});

test('T17780:C2 the Delete text hit area overlaps no other control and hides no label', async () => {
  for (const size of SIZES) {
    await s.page.setViewportSize(size);
    const m = await measureDelete(s.page);
    expect(m.overlapping, `${size.width}x${size.height}: controls under the 44x44 hit area`).toEqual([]);
    expect(m.bodyStillOnTop, `${size.width}x${size.height}: text block label still tappable`).toBe(true);
  }
  expect(await creditBalance(s.page), 'credit balance (T17880: the check spends nothing)').toBe(s.balanceBefore);
});
