/**
 * realAuth — log a Playwright context in AS A REAL USER (with their real data),
 * for driving/verifying the app in dev.
 *
 * Uses the dev/staging backend endpoint POST /api/auth/dev-login {email|user_id,
 * profile_id?}, which runs the REAL session-init path (R2 download + profile
 * selection) and mints a real rb_session cookie (HttpOnly) into the context's
 * cookie jar. Pages opened from the context are then authenticated as that account
 * WITH ITS REAL DATA (T3980). The endpoint 404s in production and requires the
 * X-Test-Mode header outside local dev; this helper always sends it.
 *
 * Why this exists: rb_session is HttpOnly (can't be set via document.cookie / the
 * Playwright MCP), and the e2e test-login only creates an empty e2e@test.local
 * user. This is the supported way to drive the app as a real account with data.
 *
 * Pass profileId to load a SPECIFIC profile (hint_profile_id); omit it to load the
 * account's default selected profile.
 *
 * Usage (Playwright test):
 *   import { loginAsRealUser } from './helpers/realAuth';
 *   test('...', async ({ context, page }) => {
 *     await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
 *     await page.goto('/');               // now authenticated as the real account
 *   });
 *
 * @param {import('@playwright/test').BrowserContext | import('@playwright/test').Page} pageOrContext
 *   Either a BrowserContext or a Page — both expose `.request` sharing the same cookie jar.
 * First-login 500 retry (T5400): the staging Postgres pool serves a DEAD connection
 * after an idle period, so the FIRST `dev-login` after the machine goes idle can 500;
 * a retry (the pool then re-establishes the connection) succeeds. This is a documented
 * staging finding (memory: "Staging PG dead-connection 500"). The retry is baked in
 * HERE so specs don't each re-implement a 3x loop. It is bounded (<=3 tries, short
 * backoff) and retries ONLY on a 5xx — a 404 (user not seeded / prod) or 4xx fails
 * fast so a real misconfiguration is not masked (CLAUDE.md: no silent fallback).
 *
 * @param {string} email
 * @param {string} [profileId] optional profile GUID hint (8 hex chars)
 * @returns {Promise<object>} the dev-login payload {email, user_id, profile_id, dev_login}
 */
const DEV_LOGIN_MAX_TRIES = 3;
const DEV_LOGIN_BACKOFF_MS = 2000;

export async function loginAsRealUser(
  pageOrContext,
  email = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com',
  profileId = undefined,
) {
  const data = { email };
  if (profileId) data.profile_id = profileId;
  // E2E_API_BASE lets this helper work when baseURL is a remote frontend host
  // (e.g. staging CF Pages) that does not proxy /api to the backend.
  const apiBase = process.env.E2E_API_BASE || '/api';

  let lastRes;
  for (let attempt = 1; attempt <= DEV_LOGIN_MAX_TRIES; attempt++) {
    lastRes = await pageOrContext.request.post(`${apiBase}/auth/dev-login`, {
      data,
      headers: { 'X-Test-Mode': 'true' },
    });
    if (lastRes.ok()) return lastRes.json();
    // Only a 5xx is the staging PG stale-pool blip worth retrying; a 4xx (404 =
    // user not seeded / prod, 401/403) is a real misconfig — fail fast, don't mask it.
    if (lastRes.status() < 500 || attempt === DEV_LOGIN_MAX_TRIES) break;
    console.log(`[T5400] dev-login ${lastRes.status()} for ${email} (attempt ${attempt}/${DEV_LOGIN_MAX_TRIES}) — retrying (staging PG stale-pool blip)`);
    await new Promise((r) => setTimeout(r, DEV_LOGIN_BACKOFF_MS));
  }

  throw new Error(`dev-login failed (${lastRes.status()}) for ${email}: ${await lastRes.text()}\n` +
    'Is the backend running (dev/staging, not prod) and does this user exist in Postgres?');
}

/**
 * Open a saved game directly in the Annotate view as the logged-in user.
 * Sets the pendingGameId breadcrumb (sessionStorage) then navigates to /annotate,
 * which AnnotateScreen consumes on mount to load the game.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number|string} gameId
 */
export async function openGameInAnnotate(page, gameId) {
  await page.goto('/');
  await page.evaluate((id) => sessionStorage.setItem('pendingGameId', String(id)), gameId);
  await page.goto('/annotate');
}
