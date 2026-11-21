import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T18040:C3 - "Use my videos to help test and improve ReelBallers" under "Your privacy
 * rights" in Account settings turns the internal-testing use off and on; each change is
 * one write, and the value survives a reload. The check leaves the switch where it found it.
 */
test.setTimeout(240000);

const LABEL = 'Use my videos to help test and improve ReelBallers';

async function openSettings(page, email) {
  await page.getByTitle(email, { exact: true }).first().click({ timeout: 60000 });
  await page.getByRole('button', { name: 'Account settings' }).click();
  await expect(page.getByText('Your privacy rights')).toBeVisible({ timeout: 30000 });
  const toggle = page.getByRole('switch', { name: LABEL });
  await expect(toggle).toBeEnabled({ timeout: 30000 });
  return toggle;
}

test('T18040:C3 the testing switch turns off and on, one write each, and survives a reload', async ({ page }) => {
  await loginForCheck(page, { devPreset: 'empty' });
  const me = await page.request.get(checkApi('/auth/me'));
  expect(me.ok()).toBe(true);
  const { email, use_for_testing: startedOn } = await me.json();
  await page.request.delete(checkApi('/me/resume-point'));

  const writes = [];
  page.on('request', (r) => {
    if (r.url().includes('/auth/testing-consent')) writes.push([r.method(), r.postDataJSON()]);
  });

  await page.goto('/');
  // Guidance's shade would swallow the clicks on the account menu (checkAuth.js).
  await expect(page.getByTestId('guidance-toggle').first()).toBeVisible({ timeout: 60000 });
  await disableGuidanceForCheck(page);
  let toggle = await openSettings(page, email);
  const before = startedOn ? 'true' : 'false';
  const flipped = startedOn ? 'false' : 'true';
  await expect(toggle).toHaveAttribute('aria-checked', before);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', flipped, { timeout: 30000 });
  expect(writes).toEqual([['PUT', { use_for_testing: !startedOn }]]);

  await page.reload();
  toggle = await openSettings(page, email);
  await expect(toggle).toHaveAttribute('aria-checked', flipped);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', before, { timeout: 30000 });
  expect(writes).toEqual([
    ['PUT', { use_for_testing: !startedOn }],
    ['PUT', { use_for_testing: startedOn }],
  ]);

  await page.reload();
  toggle = await openSettings(page, email);
  await expect(toggle).toHaveAttribute('aria-checked', before);
});

/**
 * T18040:C1 - an existing user who has not acknowledged the current policy version sees the
 * notice once after signing in; after "Got it" it does not return, on any device.
 *
 * "Existing user" = an account from before the feature, whose users.policy_version_acknowledged
 * is NULL. New accounts get the current version at sign-up (C2), so the check takes a fresh
 * dev preset and puts it back in the pre-feature state in Postgres, then signs in again so the
 * session is read from that row. Seeding needs the stack's database, which a deployed target
 * does not give the check runner: on staging this check is skipped, not passed.
 */
const NOTICE_TITLE = 'We updated our privacy policy';

function makePreFeatureAccount(userId) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('[T18040:C1] DATABASE_URL is not set: cannot seed a pre-feature account');
  const out = execFileSync('python', ['-c', `
import sys, psycopg2
conn = psycopg2.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("UPDATE users SET policy_version_acknowledged = NULL WHERE user_id = %s", (sys.argv[2],))
print(cur.rowcount)
conn.commit()
`, url, userId], { encoding: 'utf8' });
  expect(out.trim()).toBe('1');
}

// A sign-in on its own: the dev-login endpoint without realAuth's fixture acknowledgement.
async function signIn(pageOrContext, email) {
  const res = await pageOrContext.request.post(checkApi('/auth/dev-login'), {
    data: { email },
    headers: { 'X-Test-Mode': 'true' },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

// Opens the app and waits until it has read /auth/me and drawn Home.
async function openApp(page) {
  const me = page.waitForResponse((r) => r.url().includes('/auth/me') && r.ok(), { timeout: 60000 });
  await page.goto('/');
  await me;
  await expect(page.getByTestId('guidance-toggle').first()).toBeVisible({ timeout: 60000 });
}

test('T18040:C1 a pre-feature account sees the notice once; after Got it it does not return on any device', async ({ page, browser }) => {
  test.skip(!!process.env.E2E_BASE_URL, '[T18040:C1] needs the stack database to seed a pre-feature account');

  const { user_id: userId, email } = await loginForCheck(page, { devPreset: 'empty' });
  await page.request.delete(checkApi('/me/resume-point'));
  makePreFeatureAccount(userId);
  await signIn(page, email);

  const acks = [];
  page.on('request', (r) => {
    if (r.url().includes('/auth/acknowledge-policy')) acks.push(r.method());
  });

  await openApp(page);
  const notice = page.getByRole('dialog', { name: NOTICE_TITLE });
  await expect(notice).toBeVisible({ timeout: 30000 });
  await notice.getByRole('button', { name: 'Got it' }).click();
  await expect(notice).toBeHidden({ timeout: 30000 });
  expect(acks).toEqual(['POST']);

  // Same device: a reload does not bring it back.
  await page.reload();
  await expect(page.getByTestId('guidance-toggle').first()).toBeVisible({ timeout: 60000 });
  await disableGuidanceForCheck(page);
  await expect(page.getByText(NOTICE_TITLE)).toHaveCount(0);

  // Another device: a fresh browser with its own sign-in does not see it either.
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage, email);
    await openApp(otherPage);
    await expect(otherPage.getByText(NOTICE_TITLE)).toHaveCount(0);
    const me = await otherPage.request.get(checkApi('/auth/me'));
    expect((await me.json()).needs_policy_notice).toBe(false);
  } finally {
    await other.close();
  }
  expect(acks).toEqual(['POST']);
});
