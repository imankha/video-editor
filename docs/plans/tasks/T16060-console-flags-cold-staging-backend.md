# T16060: Console flags a cold staging backend

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-11

## In plain words

**Today.** The staging backend (the server that test builds talk to) shuts down when idle. The first requests after a pause are slow or fail outright while it starts up. Production stays up, so parents never see this. In the browser console the two look the same: a request that died because staging was asleep reads exactly like a request that died because of a bug.

**The problem and how we got here.** The owner reports that staging shows a lot of failed requests until it warms up. When a screen then breaks, nobody can tell from the console whether it is a real bug that will reach production or just staging waking up. The 2026-11-09 QA pass filed several "possible" bugs for exactly this reason (T15710 poster and preflight errors "seen once each"). The 2026-11-11 Frame hang (T16040) took longer to judge for the same reason, and the staging session above showed 3-second health and bootstrap requests on first load.

**What we will do.** The app already checks the server's health when it starts and retries during a cold start (the connection status banner). We will make it record when the backend was cold: how long the first health check took, and when the backend became healthy. Every request that fails or runs slow while the backend is cold, or shortly after, gets a console line saying so: "staging backend was waking up; this is not a production bug". Failures outside that window are not marked and keep their normal error. Production builds never print the cold-start note, because production does not go cold.

**Why this and not something else.** Keeping staging warm all the time would cost money and hide the slow-first-request behaviour that is real there. Retrying every request until it succeeds would hide genuine failures. Tagging the failure keeps every error visible and adds the one fact a tester needs to sort it.

**How we will know it worked.** Open staging after it has been idle long enough to shut down. Each failed or slow request in the first stretch carries the cold-start note and the time the backend became healthy. The same failures caused on a warm backend (for example by pointing a request at a missing id) carry no note.

## Implementer details

- `components/ConnectionStatus.jsx` already runs the startup health check with a 10 s first timeout and a fast-retry schedule for cold starts. Make it the single owner of a small store (or module state) holding `backendColdUntil` (the time `/api/health` first answered OK, after a first check that failed or took over a threshold such as 2 s) and the first check's latency.
- `utils/clientLogger.js` already emits `[SLOW FETCH] ... req_id=...`. Extend it, and the failure path in `utils/apiFetch.js`, to append ` [COLD BACKEND: healthy after Xs, staging only, not a prod bug]` when the request started before `backendColdUntil` plus a short grace period (for example 15 s).
- Only on non-production environments. Gate on the existing API base or environment config, not on the hostname string at each call site.
- Fly proxy failures during wake-up look like 502 or 503, a fetch `TypeError` (connection reset) or CORS-looking failures on a preflight. Classify those as cold-start-shaped only inside the window; outside it they stay normal errors.
- Pairs with T16050: the `[LOAD]` stuck report should include the cold-backend note when the outstanding need's request fell in the window.

### Acceptance criteria
- [ ] C1: On staging, a request that fails or is slow while the backend is starting logs the cold-backend note with the time the backend became healthy.
- [ ] C2: The same kind of failure on a warm backend logs no note.
- [ ] C3: Production builds never print the note.

### Related tasks
T16050 (loading screens log what they wait for), T16040, T15710, T15450, T15720 (staging-only "possible" bugs this would help sort).
