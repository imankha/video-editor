/**
 * realAuth — log a Playwright context in AS A REAL USER (with their real data),
 * for driving/verifying the app in dev.
 *
 * Uses the dev-only backend endpoint POST /api/auth/dev-login {email}, which mints
 * a real rb_session cookie (HttpOnly) into the context's cookie jar. Pages opened
 * from the context are then authenticated as that account. The endpoint is gated
 * to APP_ENV in {dev,development,local} and 404s on staging/prod.
 *
 * Why this exists: rb_session is HttpOnly (can't be set via document.cookie / the
 * Playwright MCP), and the e2e test-login only creates an empty e2e@test.local
 * user. This is the supported way to drive the app as a real account with data.
 *
 * Usage (Playwright test):
 *   import { loginAsRealUser } from './helpers/realAuth';
 *   test('...', async ({ context, page }) => {
 *     await loginAsRealUser(context, 'imankh@gmail.com');
 *     await page.goto('/');               // now authenticated
 *   });
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} email
 * @returns {Promise<object>} the dev-login payload {email, user_id, dev_login}
 */
export async function loginAsRealUser(context, email = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com') {
  const res = await context.request.post('/api/auth/dev-login', { data: { email } });
  if (!res.ok()) {
    throw new Error(`dev-login failed (${res.status()}) for ${email}: ${await res.text()}\n` +
      'Is the backend running in dev (APP_ENV=dev) and does this user exist in Postgres?');
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
