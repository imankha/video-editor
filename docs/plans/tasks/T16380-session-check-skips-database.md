# T16380: Signed-in requests skip the repeated session lookup

**Status:** WIP
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** Every request a signed-in parent's browser sends is checked against the accounts database before anything else happens: "is this sign-in still valid?" Opening the app sends a burst of such requests at once.

**The problem and how we got here.** That check is slow and handles one request at a time. On 2026-11-13 the owner sat on the loading screen on production and reported it. We measured production the same day: one request with a sign-in cookie waits 0.2 to 0.6 seconds on the check, 12 at once wait 6.3 seconds each, and 24 at once wait 9.1 seconds each. The same requests without a cookie answer in 0.07 seconds. The queue is shared, so one parent's burst slows every other signed-in parent.

**What we will do.** Remember each valid sign-in inside the server for a short time (about a minute), so only the first request of a burst asks the database and the rest are answered from memory. Signing out, an admin ending someone's sessions, and the end of an admin's "view as this user" session clear the remembered entry at once.

**Why this and not something else.** It removes the database from almost every request, which helps more than making each lookup faster. Keeping connections open (T16390) and moving the database closer (T16410) shorten each lookup but still pay for it on every request. Production runs one server, so memory inside that server is enough; no new service is needed.

**How we will know it worked.** On production, 12 requests at once with a sign-in cookie answer in under 0.5 seconds each (6.3 seconds today), and the server's timing log shows the sign-in check at 0 milliseconds for all but the first request of a burst. Signing out still takes effect on the very next request.

## Implementer details

- The check is `validate_session` (`src/backend/app/services/auth_db.py`), called from the request middleware (`src/backend/app/middleware/db_sync.py`, the `auth_ms` timing) through `asyncio.to_thread`. `/api/auth/me` validates again inside its handler, which is why it costs about twice `/api/version`.
- Cache key: session id. Value: the dict `validate_session` returns, plus the session's `expires_at` and `impersonation_expires_at` so an entry is never served past either. TTL about 60 seconds. Cache only valid sessions; a miss or an invalid cookie always goes to Postgres.
- Invalidate on every path that removes or changes a session: `invalidate_session`, `invalidate_user_sessions` (both in `auth_db.py`), the expired-session sweep, impersonation start and stop, account deletion, terms acceptance (the cached row carries `terms_accepted_at`) and profile picture or Google link changes if they are read from the cached row.
- Thread safety: the check runs on worker threads; guard the dict with a lock or use a structure that is safe for concurrent reads and writes.
- Production is one Fly machine. If a second machine is ever added, sign-out would take up to one TTL to reach the other machine; say so in the knowledge doc.
- Reproduce the measurement without an account: `curl -H "Cookie: rb_session=probe-not-a-real-session" https://reel-ballers-api.fly.dev/api/version`, 12 in parallel. An invalid cookie exercises the same lookup. A real improvement needs a valid session, so the check must sign in (staging: the seeded check account).
- Knowledge doc: `.claude/knowledge/backend-services.md`.

## Acceptance Criteria

- [ ] With a valid sign-in, 12 simultaneous requests to a do-nothing endpoint each answer in under 0.5 seconds on staging, and the timing log shows the session check at 0 ms for the requests after the first.
- [ ] After sign-out, the next request with the old cookie is refused (401), with no wait for the remembered entry to age out.
- [ ] After an admin ends a user's sessions, that user's next request is refused.
- [ ] A "view as this user" session that reaches its time limit is refused on the next request, and the audit row is still written.
- [ ] A session that expires while remembered is refused once its expiry time passes.
