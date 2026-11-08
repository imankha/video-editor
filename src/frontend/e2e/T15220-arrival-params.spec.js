import { test, expect } from '@playwright/test';
import { loginAsDevPreset } from './helpers/realAuth';

/**
 * T15220: query params App owns survive the store's module-load canonicalization until
 * App has read them, and do not stay in the address afterwards. Also covers the
 * payment-return auto-export, which previously never fired (a ref-based trigger raced the
 * export button's own mount).
 *
 * Run: bash scripts/dev-verify.sh e2e/T15220-arrival-params.spec.js --reporter=line
 */

const storedCampaign = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('campaignParams') || '{}'));

async function countVerifyCalls(page, { status = 'credits_granted', credits = 10 } = {}) {
  const calls = [];
  await page.route('**/api/payments/verify', (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ json: { status, credits } });
  });
  return calls;
}

test.describe('T15220 arrival params', () => {
  test('a signed-out campaign arrival stores its params and leaves a clean address', async ({ page }) => {
    await page.goto('/?utm_source=news&utm_campaign=fall&ref=abc&sport=soccer&fbclid=1&lref=example.com');

    await expect.poll(() => storedCampaign(page), { timeout: 30000 }).toMatchObject({
      utm_source: 'news',
      utm_campaign: 'fall',
      ref: 'abc',
      ref_sport: 'soccer',
      click_source: 'facebook',
      referrer_host: 'example.com',
    });
    await expect.poll(() => new URL(page.url()).search).toBe('');
    expect(new URL(page.url()).pathname).toBe('/home');
  });

  test('an unrelated param does not reach the address or the attribution', async ({ page }) => {
    await page.goto('/?foo=1&utm_source=news');

    await expect.poll(() => storedCampaign(page), { timeout: 30000 }).toMatchObject({ utm_source: 'news' });
    await expect.poll(() => new URL(page.url()).search).toBe('');
    expect(await storedCampaign(page)).not.toHaveProperty('foo');
  });

  test('a campaign param on a share link stays on the public route', async ({ page }) => {
    await page.goto('/shared/not-a-real-token?utm_source=news');

    await expect.poll(() => storedCampaign(page), { timeout: 30000 }).toMatchObject({ utm_source: 'news' });
    expect(new URL(page.url()).searchParams.get('utm_source')).toBe('news');
  });

  test('a signed-in Stripe return verifies once, confirms, and clears the address', async ({ page }) => {
    await loginAsDevPreset(page, 'full');
    const calls = await countVerifyCalls(page);

    await page.goto('/?payment=success&session_id=cs_test_t15220');

    await expect.poll(() => calls.length, { timeout: 30000 }).toBe(1);
    expect(calls[0]).toEqual({ session_id: 'cs_test_t15220' });
    await expect(page.getByText(/10 credits/i).first()).toBeVisible({ timeout: 10000 });
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await page.waitForTimeout(1000);
    expect(calls).toHaveLength(1);
  });

  test('a Stripe return goes back to the page the user paid from', async ({ page }) => {
    await loginAsDevPreset(page, 'full');
    const calls = await countVerifyCalls(page);
    await page.goto('/home');
    await page.waitForLoadState('networkidle');
    const projects = await page.evaluate(async () => (await fetch('/api/projects', { credentials: 'include' })).json());
    const projectId = projects[0].id;
    await page.evaluate((id) => {
      sessionStorage.setItem('paymentReturnMode', 'framing');
      sessionStorage.setItem('paymentReturnProjectId', String(id));
    }, projectId);

    await page.goto('/?payment=success&session_id=cs_test_t15220_return');

    await expect.poll(() => calls.length, { timeout: 30000 }).toBe(1);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toBe(`/focus/p/${projectId}`);
    expect(await page.evaluate(() => sessionStorage.getItem('paymentReturnMode'))).toBeNull();
  });

  test('a Stripe return with paymentAutoExport fires the export once the editor is ready', async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsDevPreset(page, 'full');
    const calls = await countVerifyCalls(page);
    await page.goto('/home');
    await page.waitForLoadState('networkidle');
    const projects = await page.evaluate(async () => (await fetch('/api/projects', { credentials: 'include' })).json());
    // Avoid a project with has_working_video: true -- opening it makes useProjectLoader
    // run extractVideoMetadataFromUrl() on the already-exported working video, a real
    // browser video-element load that can hang for a long time in this sandbox and has
    // nothing to do with what this test is proving (export fires once the editor mounts).
    const project = projects.find((p) => !p.has_working_video && p.clip_count > 0) || projects[0];
    const projectId = project.id;
    const exportCalls = [];
    await page.route('**/api/export/render', (route) => {
      exportCalls.push(route.request().url());
      return route.fulfill({ json: { export_id: 'exp_t15220_autoexport' } });
    });
    await page.evaluate((id) => {
      sessionStorage.setItem('paymentReturnMode', 'framing');
      sessionStorage.setItem('paymentReturnProjectId', String(id));
      sessionStorage.setItem('paymentAutoExport', 'true');
    }, projectId);

    await page.goto('/?payment=success&session_id=cs_test_t15220_autoexport');

    await expect.poll(() => calls.length, { timeout: 30000 }).toBe(1);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toBe(`/focus/p/${projectId}`);
    // The editor's own bootstrap (project/clips/bootstrap fetches, and the clip's own
    // video element loading enough metadata for the export button to mount) can itself
    // take tens of seconds on a loaded dev stack -- give this comfortably more room than
    // a human would wait.
    await expect.poll(() => exportCalls.length, { timeout: 180000 }).toBeGreaterThan(0);
  });

  test('a cancelled Stripe return clears the address without verifying', async ({ page }) => {
    await loginAsDevPreset(page, 'full');
    const calls = await countVerifyCalls(page);

    await page.goto('/?payment=cancelled');

    await expect.poll(() => new URL(page.url()).search, { timeout: 30000 }).toBe('');
    expect(calls).toHaveLength(0);
  });
});
