/**
 * T16525 - per-criterion acceptance checks (group checks protocol).
 *
 * The server finishes a highlight the moment sharpening ends (T16520). This task is what the
 * parent sees: the ready panel says "It's in your Highlights" with no Finish tap, a returning
 * parent is told the same and finds it in Highlights, and a spotlight render lands on the
 * finished highlight with no second Finish tap.
 *
 * One login and ONE real sharpen (a paid render) in beforeAll, shared by every criterion: the
 * setup waits only for the ready panel, whatever it says, so each criterion asserts on its own.
 * (A dev preset login clones a fresh account each time; a failed test restarts the worker and
 * so repeats the setup.)
 *
 * C4 (a failed automatic finish keeps a working Finish button) cannot be forced from a browser on
 * a deployed target; it is a code check (T16525.checks.json).
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16525.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

const IN_HIGHLIGHTS = 'It’s in your Highlights';
const FINISH_CARD = 'focus-choice-publish';

let context;
let page;
let finished = null; // { id, name } of the highlight the setup sharpened

/** GET an API path from inside the page (staging 401s page.request after the app's own session, T16100). */
async function pageApi(path) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, checkApi(path));
}

async function listProjects() {
  const res = await pageApi('/projects');
  expect(res.ok, `GET /projects -> ${res.status}`).toBe(true);
  return Array.isArray(res.body) ? res.body : res.body.projects || [];
}

/** True when nothing in the panel sticks out sideways and the headline sits inside the viewport. */
async function panelFits() {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="focus-publish-action-bar"]');
    const heading = bar?.querySelector('h2');
    if (!bar || !heading) return { ok: false, why: 'panel or headline missing' };
    const vw = document.documentElement.clientWidth;
    const overflowing = [bar, ...bar.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.left < -1 || r.right > vw + 1);
    }).map((el) => el.getAttribute('data-testid') || el.tagName);
    const h = heading.getBoundingClientRect();
    return {
      ok: overflowing.length === 0 && bar.scrollWidth <= bar.clientWidth + 1 && h.top >= 0 && h.bottom <= window.innerHeight,
      why: JSON.stringify({ overflowing: overflowing.slice(0, 5), scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, heading: [h.top, h.bottom], vh: window.innerHeight }),
    };
  });
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(600000);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginForCheck(context);
  page = await context.newPage();

  // Sharpen a draft the way a parent does, and wait for the ready panel.
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  const projects = await listProjects();
  const draft = projects.find((p) => (p.clip_count || 0) === 1 && !p.has_working_video && !p.has_final_video);
  if (!draft) return; // each test skips loudly below
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
  finished = { id: draft.id, name: draft.name };
});

test.afterAll(async () => {
  await context?.close();
});

test('T16525:C1 - after a highlight is sharpened, the parent is told it is in Highlights without tapping Finish', async () => {
  test.skip(!finished, '[T16525] no single-clip draft that has not been sharpened yet in this account');
  // The panel the sharpen opened, untouched.
  const bar = page.getByTestId('focus-publish-action-bar');
  await expect(bar.getByRole('heading', { name: IN_HIGHLIGHTS })).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId(FINISH_CARD)).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Add spotlight' })).toBeVisible();

  // It really is in Highlights already: nothing was tapped.
  const highlights = await pageApi('/downloads');
  expect(highlights.ok).toBe(true);
  const list = highlights.body.downloads || highlights.body;
  expect(list.some((d) => d.project_id === finished.id), 'the sharpened highlight is listed in Highlights').toBe(true);
});

test('T16525:C2 - a parent who returns later sees the same message and finds the highlight in Highlights', async () => {
  test.setTimeout(180000);
  test.skip(!finished, '[T16525] the setup sharpened no highlight to come back to');
  // Leave without tapping anything, then come back on a fresh page load.
  await page.goto('/home');
  const card = page.getByTestId('focus-completion-recovery');
  await expect(card).toContainText('Your highlight is in Highlights', { timeout: 60000 });
  await card.getByRole('button', { name: 'View' }).click();
  const bar = page.getByTestId('focus-publish-action-bar');
  await expect(bar.getByRole('heading', { name: IN_HIGHLIGHTS })).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId(FINISH_CARD)).toHaveCount(0);
  await bar.getByRole('button', { name: 'Done' }).click();

  await page.goto('/home');
  await page.getByTestId('home-tab-published').click();
  await expect(page.getByText(finished.name, { exact: false }).first()).toBeVisible({ timeout: 60000 });
});

test('T16525:C3 - after a spotlight render there is no second Finish tap', async () => {
  test.setTimeout(480000);
  test.skip(!finished, '[T16525] the setup sharpened no highlight to add a spotlight to');
  await page.goto(`/overlay/p/${finished.id}`);
  await page.getByTestId('overlay-video-stage').waitFor({ timeout: 90000 });
  const render = page.getByRole('button', { name: 'Add spotlight to highlight' }).first();
  await expect(render).toBeEnabled({ timeout: 60000 });
  await render.click();

  // It lands on the finished highlight (the reel player), never on a panel asking for Finish.
  await expect(page.getByText(IN_HIGHLIGHTS).first()).toBeVisible({ timeout: 420000 });
  await expect(page.getByTestId('overlay-publish-action-bar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Finish$/ })).toHaveCount(0);
  const highlights = await pageApi('/downloads');
  const list = highlights.body.downloads || highlights.body;
  expect(list.filter((d) => d.project_id === finished.id).length, 'one finished version in Highlights').toBe(1);
});

for (const vp of [{ label: 'phone 390x844', width: 390, height: 844 }, { label: 'desktop 1440x900', width: 1440, height: 900 }]) {
  test(`T16525:C5 - the in-Highlights message shows without overflow @ ${vp.label}`, async () => {
    test.setTimeout(180000);
    test.skip(!finished, '[T16525] the setup sharpened no highlight to reopen');
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/focus/p/${finished.id}`);
    // "Watch highlight" reopens the same ready panel with no new render.
    const watch = page.getByRole('button', { name: 'Watch highlight' }).first();
    await watch.waitFor({ timeout: 90000 });
    await watch.click();
    const bar = page.getByTestId('focus-publish-action-bar');
    await expect(bar.getByRole('heading', { name: IN_HIGHLIGHTS })).toBeVisible({ timeout: 60000 });
    await expect(bar.getByTestId('focus-finished-note')).toBeVisible();
    const fit = await panelFits();
    expect(fit.ok, `panel overflows at ${vp.label}: ${fit.why}`).toBe(true);
  });
}
