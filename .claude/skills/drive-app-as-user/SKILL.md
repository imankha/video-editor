# Drive the app AS A REAL USER (Playwright + dev auth)

Authenticate Playwright as a **real account with real data** and drive the app to
reproduce/verify behavior in dev. Use this whenever you need to observe the running app
(console traces, rendering, real data) instead of guessing — including from a /dotask
container worker. No LLM grokking required: the recipe below is fixed.

## When to apply
- Reproducing/verifying a UI bug that only manifests in the running app (rendering, effects,
  load order) rather than in unit tests.
- "Run it yourself and read the logs" loops: add `console.warn` tracing, then drive + capture.
- Any flow that needs a real user's real data (games, reels, annotations) — NOT the empty
  `e2e@test.local` user that `/api/auth/test-login` creates.

## Why the obvious paths don't work
- `rb_session` is **HttpOnly** (`src/backend/app/utils/cookies.py`), so it can't be set via
  `document.cookie` or the Playwright MCP `browser_*` tools.
- `apiFetch` just sends the cookie (`credentials: include`); there is no `X-User-ID` auto-inject.
- `test-login` only creates the empty `e2e@test.local` user (no games/reels).

## The capability

### 1. Backend: `POST /api/auth/dev-login`  (dev-only)
`src/backend/app/routers/auth.py`. Body `{"email": "..."}` (or `X-Dev-Login-Email` header).
Mints a real `rb_session` for that account and sets the cookie. **Gated to `APP_ENV in
{dev,development,local}`** — 404s on staging/prod (logging in as an arbitrary email is unsafe
anywhere shared). Works for curl too:
```bash
curl -s -X POST http://localhost:5173/api/auth/dev-login \
  -H 'Content-Type: application/json' -d '{"email":"imankh@gmail.com"}' -i   # -> Set-Cookie: rb_session=...
```

### 2. Playwright helper: `e2e/helpers/realAuth.js`
```js
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';

test('...', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com');  // cookie -> context jar; pages are authed
  await page.goto('/');                                 // authenticated
  // open a saved game straight into Annotate (sets pendingGameId + nav to /annotate):
  await openGameInAnnotate(page, 5);
});
```
`loginAsRealUser` POSTs to `/api/auth/dev-login` via `context.request` so the HttpOnly cookie
lands in the context. `openGameInAnnotate` sets the `pendingGameId` breadcrumb (sessionStorage)
then navigates to `/annotate`, which `AnnotateScreen` consumes on mount.

### 3. Run against the already-running dev app (don't autostart a second server)
```bash
cd src/frontend && E2E_BASE_URL=http://localhost:5173 \
  npx playwright test e2e/<your>.spec.js --reporter=line
```
Canonical example/regression: `e2e/annotate-annotations-render.spec.js`.

## Capture-and-iterate loop (the "run it yourself" pattern)
1. Add **`console.warn('[DBG] ...')`** tracing across the suspect path (NOT `console.log` — the dev
   console filters Info level, so `console.log` is invisible).
2. In the spec, collect console: `page.on('console', m => logs.push(\`[${m.type()}] ${m.text()}\`))`
   and `page.on('pageerror', ...)`; `console.log(logs.join('\n'))` at the end.
3. Run, read the trace, narrow, repeat. Strip the `[DBG]` logging before committing the fix.

## From inside a /dotask container
A /dotask container worker can run the **entire** live-verify loop itself — no supervisor needed.
Run this one command from the repo root inside the container:
```bash
bash scripts/dev-verify.sh e2e/<your>.spec.js [extra playwright args...]
# e.g.
bash scripts/dev-verify.sh e2e/annotate-soccer-times.spec.js --reporter=line
```
`dev-verify.sh` starts the stack via `.devcontainer/container-stack.sh` (idempotent — reuses an
already-running stack), waits for the frontend + backend `/api/health`, self-heals chromium, then
runs the spec and exits with Playwright's code.

- **DB host is handled for you.** The container `.env` has `DATABASE_URL=…@localhost:5432`, which is
  wrong inside the container. `container-stack.sh` exports a `DATABASE_URL` override rewriting the
  host to `host.docker.internal` (the shared dev Postgres on the host machine) — it does **not** edit
  `.env`, so host-side scripts keep their `localhost` semantics. Don't edit `.env` or add a second
  rewrite.
- **Dev-login data prerequisite.** realAuth specs `dev-login` as a real account; that email must exist
  in this env's Postgres (reached via `host.docker.internal`). If dev-login 404s on the user, seed it:
  `scripts/copy_user_between_envs.py --from production --to dev`.
- A worker **no longer needs the supervisor's `task.sh test`** for live verification — use
  `dev-verify.sh` and only fall back to the supervisor if blocked (e.g. a host-side Postgres bind
  issue you can't fix from inside the container).

The same `loginAsRealUser` helper + `dev-login` endpoint work in-container; `dev-verify.sh` just wires
up the stack + correct DB host around them.

## Gotchas
- Email must exist in the env's Postgres `users` table (use a real account, e.g. one copied down
  via `scripts/copy_user_between_envs.py --from production --to dev`).
- Dev per-user data is version-synced from R2; if data looks stale see the
  `changing-env-data` / dev-DB notes (higher db-version wins — don't run a second backend with an
  older local copy).
