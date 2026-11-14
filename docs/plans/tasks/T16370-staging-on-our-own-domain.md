# T16370: Serve staging from reelballers.com so Safari can sign in

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** Staging's app is at `reel-ballers-staging.pages.dev` and its API at `reel-ballers-api-staging.fly.dev`. Production's app and API are both on `reelballers.com` (the API is `api.reelballers.com`).

**The problem and how we got here.** Two different sites means the sign-in cookie the API sets is a third-party cookie from the app's point of view. Safari blocks third-party cookies by default, so **nobody can stay signed in to staging in Safari** (iPhone, iPad or Mac). T15450 (2026-11-09 QA) set the cookie to `SameSite=None; Secure`, which fixed it for Chrome but cannot fix it for Safari. On 2026-11-13 we ran staging in WebKit, Safari's engine, with iPhone 14 emulation: sign-in returned 200 but the browser stored no session cookie, and `/auth/me` answered 401 after a reload. The same run in Chromium kept the cookie. The owner has no iPhone, so this WebKit run is how Safari gets tested, and today it cannot get past sign-in. T15720 (does video play in Safari) cannot be verified at all until this is fixed, and nor can any later Safari check on staging.

**What we will do.** Put staging on our own domain, for example `staging.reelballers.com` for the app and `api-staging.reelballers.com` for the API, the same shape as production. The session cookie is then first-party and Safari keeps it. Update everything that names the old staging hosts: CORS allowlists, the R2 bucket's CORS rules, OAuth redirect URLs, the deploy workflows, the e2e and /dotask staging-check settings, and the docs.

**Why.** Staging is where every merged change is tested (it is the test phase), and Safari is the browser most parents on iPhone use. A staging that Safari cannot sign in to hides every Safari-only bug until production.

**How we will know it worked.** The WebKit iPhone 14 run signs in on staging, stays signed in after a reload and after closing and reopening the browser, and plays video in Annotate.

## Implementer details

- WebKit run used on 2026-11-13: Playwright `webkit` with `devices['iPhone 14']`, sign-in by `fetch(API + '/auth/dev-login', {credentials: 'include', headers: {'X-Test-Mode': 'true'}})` from inside the page (so Safari's cookie rules apply), then `/auth/me` after a reload and in a new context built from the saved `storageState`. Make this a committed browser check that runs in the `webkit` project.
- Old staging hosts appear in `scripts/dotask_cli.py` (`STAGING`, overridable by `DOTASK_STAGING_URL` / `DOTASK_STAGING_API`), `src/frontend` env and build config, `.github/workflows/deploy-*.yml`, backend CORS settings, and the R2 CORS rules (T15710, T15720). Grep for `pages.dev` and `fly.dev`.
- DNS for `reelballers.com` and Cloudflare Pages custom domains are owner-account actions: list the exact records for the owner to add.
- Knowledge doc: `.claude/knowledge/backend-services.md`.

## Owner steps (before the PR merges)

Merging moves staging's build to the new hosts at once, so these must be in place first or staging stops working:

1. **Cloudflare Pages:** project `reel-ballers-staging` -> Custom domains -> add `staging.reelballers.com` (Cloudflare creates the proxied CNAME `staging` -> `reel-ballers-staging.pages.dev`).
2. **Fly:** `fly certs add api-staging.reelballers.com -a reel-ballers-api-staging`, then in Cloudflare DNS add CNAME `api-staging` -> `reel-ballers-api-staging.fly.dev`, **DNS only (gray cloud)**, same as `api` for prod. Wait for `fly certs show api-staging.reelballers.com -a reel-ballers-api-staging` to say issued.
3. **R2 CORS:** `cd src/backend && python scripts/configure_r2_cors.py` (now allows `https://staging.reelballers.com`).
4. **Google OAuth client:** add `https://staging.reelballers.com` to Authorized JavaScript origins.
5. **Stripe (staging webhook), if it points at the fly.dev host:** optional, the fly.dev host keeps resolving; switch it to `https://api-staging.reelballers.com/...` for consistency.
6. Merge. Then run the WebKit check (C1, C2): `cd src/frontend && npx playwright install --with-deps webkit && E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api npx playwright test e2e/checks/T16370.check.spec.js --reporter=line`.

No redirect from the old hosts is kept: `reel-ballers-staging.pages.dev` still serves the build, but the API's CORS now only allows the new host, so sign-in works only on `staging.reelballers.com`.

## Acceptance Criteria

- [ ] A WebKit (iPhone 14) browser check against staging signs in, stays signed in after a reload and after a new browser context with the saved cookies, and runs in CI or the /dotask staging check.
- [ ] The same WebKit check plays a video in Annotate on staging.
- [ ] No code, workflow or doc still points at the old staging hosts, except a redirect if one is kept.
