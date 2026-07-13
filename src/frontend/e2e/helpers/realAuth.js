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
 * @param {string} email
 * @param {string} [profileId] optional profile GUID hint (8 hex chars)
 * @returns {Promise<object>} the dev-login payload {email, user_id, profile_id, dev_login}
 */
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
  const res = await pageOrContext.request.post(`${apiBase}/auth/dev-login`, {
    data,
    headers: { 'X-Test-Mode': 'true' },
  });
  if (!res.ok()) {
    throw new Error(`dev-login failed (${res.status()}) for ${email}: ${await res.text()}\n` +
      'Is the backend running (dev/staging, not prod) and does this user exist in Postgres?');
  }
  return res.json();
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
