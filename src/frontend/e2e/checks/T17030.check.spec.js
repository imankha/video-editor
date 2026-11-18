/**
 * T17030 - per-criterion acceptance check (group checks protocol).
 *
 * The server takes a sharpen's credits the moment it accepts "Sharpen my highlight", but the
 * credit chip kept the old balance until the sharpen finished (minutes on staging). Each test
 * taps Sharpen, waits for GET /api/credits to show the charge, then expects the chip to equal
 * the server within a few seconds, before the sharpen can have finished.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17030.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { sharpenableDraft } from '../helpers/returnAfterSharpen';

/** Call an API path from inside the page (staging 401s page.request after the app's own session, T16100). */
async function pageApi(page, path) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, checkApi(path));
}

async function serverBalance(page) {
  const res = await pageApi(page, '/credits');
  expect(res.ok, `GET /credits -> ${res.status}`).toBe(true);
  return res.body.balance;
}

/** The header credit chip (its title reads "<n> credits. Tap to buy more"). */
function chip(page) {
  return page.locator('button[title*="Tap to buy more"]').locator('visible=true').first();
}

async function chipValue(page) {
  return Number((await chip(page).innerText()).trim());
}

/** Open a sharpenable draft in Frame and tap Sharpen; returns the balance before the charge. */
async function tapSharpen(page) {
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  const draft = await sharpenableDraft(page);
  test.skip(!draft, '[T17030] no unsharpened single-clip draft on a ready game, and no play on a ready game to make one from');

  await page.goto(`/focus/p/${draft.id}`);
  await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });
  const sharpen = page.getByRole('button', { name: 'Sharpen my highlight' }).first();
  await expect(sharpen).toBeEnabled({ timeout: 60000 });
  await expect(chip(page)).toBeVisible({ timeout: 60000 });
  const before = await serverBalance(page);
  expect(await chipValue(page), 'chip before the sharpen').toBe(before);

  await sharpen.click();
  const confirm = page.getByTestId('focus-box-confirm');
  if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await confirm.getByRole('button', { name: 'Sharpen my highlight' }).click();
  }
  // The charge lands when the server accepts the sharpen.
  await expect.poll(() => serverBalance(page), { timeout: 60000, intervals: [1000] }).toBeLessThan(before);
  return { draft, before };
}

/** Within a few seconds of the charge, the chip equals GET /api/credits. */
async function expectChipMatchesServer(page, where) {
  const after = await serverBalance(page);
  await expect.poll(() => chipValue(page), { timeout: 8000, intervals: [500], message: `${where}: chip vs server ${after}` })
    .toBe(after);
}

test('T17030:C1 - at 1440x900 the chip equals GET /api/credits within a few seconds of tapping Sharpen', async ({ browser }) => {
  test.setTimeout(600000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await loginForCheck(context);
    const page = await context.newPage();
    await tapSharpen(page);
    await expectChipMatchesServer(page, '1440x900 Frame');
  } finally {
    await context.close();
  }
});

test('T17030:C2 - at 390x844 the chip equals GET /api/credits on Frame and after going back Home mid-sharpen', async ({ browser }) => {
  test.setTimeout(600000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await loginForCheck(context);
    const page = await context.newPage();
    const { draft } = await tapSharpen(page);
    await expectChipMatchesServer(page, '390x844 Frame');

    // Back to Home by the editor's back arrow while it still sharpens (in-app, no reload).
    await page.getByTestId('editor-home').first().click();
    await page.waitForURL(/\/home/, { timeout: 60000 });
    await expect(chip(page)).toBeVisible({ timeout: 60000 });
    await expectChipMatchesServer(page, '390x844 Home');
    const projects = await pageApi(page, '/projects');
    const list = Array.isArray(projects.body) ? projects.body : projects.body.projects;
    const p = list.find((x) => x.id === draft.id);
    expect(p && p.has_final_video, 'sharpen still running when Home was checked').toBeFalsy();
  } finally {
    await context.close();
  }
});
