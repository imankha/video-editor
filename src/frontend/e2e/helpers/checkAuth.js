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
 * @param {string} path - starts with '/', without the '/api' prefix, e.g. '/projects'
 */
export function checkApi(path) {
  return `${process.env.E2E_API_BASE || '/api'}${path}`;
}
