import { test, expect, request as pwRequest } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { waitForAppReady } from './helpers/appReady.js';

/**
 * T13140 lane D (@gate-d) -- the on-demand "release path" lane, NOT part of the
 * default three-lane gate (run: `bash scripts/staging-gate.sh --lane d`).
 *
 * Why it exists: every defect the T9720 release check found lived in a seam between
 * features and was invisible to jsdom tests and the 21 lane A/B/C specs. T13110
 * (Report a problem dialog unclickable with a real mouse at >=1024px: pointer-events
 * none inherited from CornerStack) is the canonical example -- scripted DOM clicks and
 * keyboard Enter passed, only a REAL mouse hit-test fails.
 *
 * Implemented assertions (T9720-RESULTS.md section 7):
 *   - public share fetched SIGNED OUT returns 200; private endpoints return 401
 *   - Report a problem: elementFromPoint hit-test on Send at 1440x900, a REAL mouse
 *     click, exactly one report-problem request, credit balance unchanged
 *
 * Not implemented yet (see STAGING-GATE.md lane D "Open assertions"): game/clip
 * upload, the 5 s render + 5-credit charge, abort/retry paths, Finish/Share
 * triple-tap request counting.
 *
 * Own account (E2E_REAL_EMAIL, the lane D alias) so it never CAS-conflicts with A/B/C.
 * Residue: one `bug_reports` Postgres row per run (tolerated; cleaned by an admin step).
 */

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const HEADERS = { 'X-Test-Mode': 'true' };

async function getJson(ctx, path) {
  const res = await ctx.request.get(`${API_BASE}${path}`, { headers: HEADERS });
  if (!res.ok()) throw new Error(`GET ${path} -> ${res.status()}`);
  return res.json();
}

test.describe('T13140 lane D release path @gate-d', () => {
  test.describe.configure({ mode: 'serial' });

  test('public share is readable signed out; private endpoints are not', async ({ context }) => {
    test.setTimeout(120_000);
    await loginAsRealUser(context, EMAIL, PROFILE);

    const dl = await getJson(context, '/downloads');
    const reels = dl.downloads || [];
    expect(reels.length, 'lane D account needs >= 1 published reel (seed per FIXTURE-CONTRACT)').toBeGreaterThan(0);
    const share = await context.request.post(`${API_BASE}/gallery/${reels[0].id}/share`, {
      data: { recipient_emails: [], is_public: true },
      headers: HEADERS,
    });
    expect(share.ok(), `mint public share -> ${share.status()}`).toBeTruthy();
    const token = (await share.json())?.shares?.[0]?.share_token;
    expect(token, 'share_token minted').toBeTruthy();

    // A brand-new request context has NO rb_session cookie: this is the signed-out viewer.
    const anon = await pwRequest.newContext();
    try {
      const pub = await anon.get(`${API_BASE}/shared/${token}`, { headers: HEADERS });
      expect(pub.status(), 'signed-out public share fetch').toBe(200);
      for (const path of ['/downloads', '/games', '/credits']) {
        const res = await anon.get(`${API_BASE}${path}`, { headers: HEADERS });
        expect(res.status(), `signed-out GET ${path} must be 401`).toBe(401);
      }
    } finally {
      await anon.dispose();
    }
  });

  test('Report a problem: Send is hit-testable and a real mouse click files exactly one report', async ({ context, page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const before = (await getJson(context, '/credits')).balance;

    const reportRequests = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/auth/report-problem')) reportRequests.push(r.url());
    });

    await page.goto('/');
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'Report a problem' }).first().click();
    await page.getByPlaceholder(/What went wrong/).fill('T13140 lane D automated check -- safe to ignore');

    const send = page.getByRole('button', { name: /^Send report$/ });
    await expect(send).toBeEnabled();
    const box = await send.boundingBox();
    expect(box, 'Send report has a layout box').toBeTruthy();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // T13110: with pointer-events:none inherited from CornerStack, elementFromPoint
    // returns the page behind the dialog, not Send.
    const hit = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      const btn = el && el.closest('button');
      return { tag: el?.tagName, text: btn?.textContent?.trim() };
    }, [x, y]);
    expect(hit.text, `elementFromPoint(${x},${y}) must be the Send button, got <${hit.tag}>`).toMatch(/^Send report$/);

    const responsePromise = page.waitForResponse((r) => r.url().includes('/auth/report-problem'), { timeout: 30_000 });
    await page.mouse.click(x, y);
    const response = await responsePromise;
    expect(response.ok(), `report-problem -> ${response.status()}`).toBeTruthy();
    await page.waitForTimeout(1000); // a duplicate send would land inside this window
    expect(reportRequests.length, 'exactly one report-problem request').toBe(1);

    const after = (await getJson(context, '/credits')).balance;
    expect(after, 'reporting a problem never changes the credit balance').toBe(before);
  });
});
