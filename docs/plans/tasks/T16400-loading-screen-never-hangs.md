# T16400: Loading screen never hangs silently

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** When a parent opens the app, a loading screen says "Connecting to server..." until the server confirms who they are. If that answer is slow or never comes, the loading screen stays up with no message and no way out except closing the tab.

**The problem and how we got here.** On 2026-11-13 the owner was stuck on that screen on production and "finally got in but it took forever". The browser recording from that visit shows the page itself loaded in 0.3 seconds and not one server call had finished. Two things have no time limit. The app's first question to the server waits forever. And the server's own calls to the accounts database wait forever, so one dropped connection can freeze every signed-in request behind it. We could not prove which of the two caused the owner's wait, because the server keeps only a few minutes of logs.

**What we will do.** Give both waits a limit. The server gives up on a database call after a few seconds, drops that connection and tries a fresh one. The app gives up on its first question after about ten seconds, tries again, and if it still has no answer shows "Still connecting" with a Retry button. Also keep enough history that the next slow load can be explained afterwards.

**Why this and not something else.** T16380 and T16390 make the usual case fast, but they do nothing when a connection dies or the network drops. A limit and a visible retry turn a silent hang into a short delay or a clear message.

**How we will know it worked.** With the database made unreachable on a test stack, a signed-in request fails within five seconds, not minutes, and the app shows the retry message within about twenty seconds. When the database comes back, Retry gets the parent in without reloading.

## Implementer details

- Server: `src/backend/app/services/pg.py` `init_pg_pool` passes keepalive settings but no `connect_timeout`, no `tcp_user_timeout` and no statement timeout. Keepalives do not help once a query is in flight on a dead socket; `tcp_user_timeout` (milliseconds, libpq parameter) and `options='-c statement_timeout=...'` do. The pre-ping `SELECT 1` in `get_pg` is the first thing to hit a dead socket. Long admin and analytics queries need a higher statement limit than the session check; set the limit per use, not one low global value that breaks the admin screens.
- The middleware already maps Postgres errors during the session check to a retryable "unavailable" answer instead of 401 (`db_sync.py`, `session_validation_unavailable`); keep that, so a database blip never signs anyone out.
- App: `initSession` in `src/frontend/src/utils/sessionInit.js` calls `fetchWithRetry` on `/api/auth/me` with no abort. Add an `AbortController` limit per attempt. The preloader text is driven by `window.__preloaderUpdate` (`src/frontend/index.html`); the retry state needs a button there or a React screen that replaces the preloader. `/api/auth/init` and the home bootstrap behind it have the same shape; cover them or say why not.
- History: Fly's log buffer held under four minutes at the time of the incident. Either ship logs somewhere durable or have the app report its own load timings (time to first answer, total time to ready) to an existing analytics table. Pick the smaller one and name it in the PR.
- Separate small defect found in the same investigation, fix it here: `src/frontend/index.html` line 28 fetches `/storage/warmup` on the app's own site, which returns the HTML page and warms nothing. It should call the API host, or be removed if the warm-up is no longer wanted.
- Knowledge doc: `.claude/knowledge/backend-services.md`.

## Acceptance Criteria

- [ ] With the test stack's Postgres paused, a request carrying a sign-in cookie fails within 5 seconds with the retryable "unavailable" answer, and the parent is not signed out.
- [ ] After Postgres resumes, the next request succeeds without a server restart.
- [ ] With the API unreachable, the loading screen shows a "Still connecting" message and a Retry button within 20 seconds.
- [ ] Pressing Retry after the API is back opens the app without a page reload.
- [ ] The admin dashboards still load (no query cut off by the new limit).
- [ ] Each app load records how long it took to become usable, readable a day later.
- [ ] The page's early warm-up call reaches the API, or is gone.
