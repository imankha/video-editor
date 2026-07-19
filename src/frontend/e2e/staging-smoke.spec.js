import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { waitForAppReady } from './helpers/appReady.js';

/**
 * Staging smoke — the cheapest, most reliable signal in the @staging-gate subset
 * (T5400). Two fast checks that must pass before anything heavier is worth running:
 *
 *   1. API health: GET /api/health is 200 — the Fly API machine is up + warm.
 *   2. Login + shell: dev-login mints a session for the seeded fixture account and
 *      the SPA renders its shell — proves auth (incl. the first-login 500 retry) and
 *      the fixture are reachable on the target.
 *
 * Tagged @staging-gate; runs against local OR a deployed target. Uses the seeded
 * fixture account (imankh@gmail.com / profile 9fa7378c, per FIXTURE-CONTRACT.md,
 * env-overridable via E2E_REAL_EMAIL / E2E_REAL_PROFILE).
 */

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

test.describe('staging smoke @staging-gate', () => {
  test('API health responds 200', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`, { headers: { 'X-Test-Mode': 'true' } });
    expect(res.status(), `GET ${API_BASE}/health`).toBe(200);
    const body = await res.json().catch(() => ({}));
    console.log(`[smoke] /health -> ${res.status()} ${JSON.stringify(body)}`);
  });

  test('dev-login mints a session and the app shell renders', async ({ context, page }) => {
    // loginAsRealUser has the first-login 500 retry baked in (staging PG stale-pool).
    const payload = await loginAsRealUser(context, EMAIL, PROFILE);
    expect(payload.user_id, 'dev-login returned a user_id').toBeTruthy();
    console.log(`[smoke] dev-login -> user_id=${payload.user_id} profile_id=${payload.profile_id}`);

    await page.goto('/');
    await waitForAppReady(page); // app shell mounted into #root (deterministic, no networkidle)
    // A logged-in home renders the primary nav (My Reels button is always present).
    await expect(page.getByRole('button', { name: /My Reels/ }).first()).toBeVisible({ timeout: 30000 });
  });
});
