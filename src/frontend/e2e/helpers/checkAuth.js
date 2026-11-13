import { expect } from '@playwright/test';
import { loginAsDevPreset, loginAsRealUser } from './realAuth';

/**
 * Login and API helpers for /dotask acceptance checks (e2e/checks/T<id>.check.spec.js).
 *
 * A check runs twice: on the group's dev stack before the PR (the harness runs it via
 * scripts/dev-verify.sh), and against staging after merge (E2E_BASE_URL set). Dev preset
 * accounts exist only in dev, so on a deployed target this logs in as the seeded account
 * named by E2E_CHECK_EMAIL (e2e/STAGING-GATE.md lane B by default). The two accounts hold
 * different data: read ids through checkApi() after logging in, never hard-code them.
 *
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} pageOrContext
 */
export async function loginForCheck(pageOrContext) {
  if (process.env.E2E_BASE_URL) {
    return loginAsRealUser(pageOrContext, process.env.E2E_CHECK_EMAIL || 'e2e-gate@test.local');
  }
  return loginAsDevPreset(pageOrContext, 'full');
}

/**
 * The URL of an API path for page.request: the local stack proxies /api, a deployed frontend
 * does not, so a deployed target goes to E2E_API_BASE.
 *
 * On staging, page.request calls made after the app has started its own session in the page
 * got 401 (T16100); call the API before the first navigation, or from inside the page with
 * fetch(checkApi(path), { credentials: 'include' }) (see T16090.check.spec.js pageApi).
 *
 * @param {string} path - starts with '/', without the '/api' prefix, e.g. '/projects'
 */
export function checkApi(path) {
  return `${process.env.E2E_API_BASE || '/api'}${path}`;
}

/**
 * Turn Guidance OFF before a check drives transport controls (Forward/Back 5s, etc.)
 * directly: the shared e2e-gate@test.local account defaults Guidance ON, and its coach
 * guide-shade intercepts pointer events outside the active step's named cutouts
 * (`.claude/knowledge/guidance.md` "modal shade is a GUARANTEE"), silently swallowing
 * clicks on controls that aren't one of those cutouts until the check's own timeout
 * (T15930/T15940 root-caused this for T15550/T15640; T15980 is the 3rd occurrence,
 * so it's extracted here instead of re-inlined a 3rd time -- refactor rule 1).
 * Idempotent no-op if the toggle is absent or already off.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function disableGuidanceForCheck(page) {
  const toggle = page.getByTestId('guidance-toggle').first();
  if (!(await toggle.count().catch(() => 0))) return;
  if ((await toggle.getAttribute('aria-checked')) !== 'false') {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 10000 });
  }
}
