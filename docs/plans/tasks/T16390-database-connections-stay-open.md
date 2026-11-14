# T16390: Database connections stay open

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-13
**Updated:** 2026-11-14

## In plain words

**Today.** The server talks to the accounts database (sign-ins, sharing, admin numbers) over a small set of connections. It keeps two of them open and opens more when several requests arrive together, then closes the extras again.

**The problem and how we got here.** Opening a connection is slow, because the database is in Chicago and the server is in Los Angeles, and the server opens them one after another. So a burst of requests waits in a line. Measured on production on 2026-11-13 after the owner reported a stuck loading screen: 12 requests at once took 2.0 seconds each on an endpoint that does nothing else, and each extra simultaneous request added about 0.17 seconds for everyone.

**What we will do.** Keep all ten connections open all the time, so a burst finds them ready.

**Why this and not something else.** It is a two-number change with no new behaviour. It does not replace T16380 (which removes most lookups) but it speeds up every database call that remains: sign-in itself, sharing, and the admin screens. The database allows far more than ten connections, so holding ten costs nothing we will notice.

**How we will know it worked.** Before the change, record the 12-at-once time on staging with an invalid sign-in cookie; after it, the same test is at least three times faster and no longer grows in a straight line with the number of requests.

## Implementer details

- `src/backend/app/services/pg.py`, `init_pg_pool`: `ThreadedConnectionPool(minconn=2, maxconn=_MAX_POOL_CONN, ...)`. psycopg2's pool opens a new connection inside `getconn()` while holding the pool lock, and `putconn()` closes any connection returned while the free list already holds `minconn`. This is the inferred cause of the serial behaviour; confirm it first with one of the slow-request profiles the server writes to `/tmp/profiles` (expect time inside `psycopg2.connect`). If the profile shows something else, stop and report.
- Set `minconn` to `_MAX_POOL_CONN`. Startup then opens ten connections up front (about ten round trips to Chicago; check that the machine's health check still passes on a cold start and on resume from suspend).
- The idle pre-ping (`_IDLE_PING_THRESHOLD_S = 5.0`) adds two round trips to any connection idle for more than five seconds. With ten connections and light traffic most checkouts will be idle ones. Consider raising the threshold toward the keepalive window (30 seconds) in the same change, and say what was measured.
- Staging's database machine has 256 MB; confirm ten idle connections fit (Postgres default `max_connections` is 100; flex images may set it lower).
- Measure with: 12 parallel `curl -H "Cookie: rb_session=probe-not-a-real-session" <api>/api/version`.
- Knowledge doc: `.claude/knowledge/backend-services.md`.

## Measurement (2026-11-14)

Where the serial wait was. The worker had no access to the prod profiles in `/tmp/profiles`,
so the mechanism was confirmed on the real psycopg2 pool against the dev Postgres, with
`psycopg2.connect` slowed by 0.17 s per call to model the LA -> Chicago connect cost
(`src/backend/tests/test_t16390_pool_stays_open.py`):

- Before (`minconn=2`): a burst of 12 checkouts opened 8 new connections one after another,
  0.18 s apart, because psycopg2's `_getconn` calls `_connect` while holding the pool lock.
  The burst took 1.50 s. That matches prod's 2.0 s for 12 and its +0.17 s for each extra request.
  After the burst, `putconn` closed the extras again, so the next burst paid the same cost.
- After (`minconn=maxconn=10`): the same two bursts opened 0 connections and kept all 10.
  Each burst finished in under 0.57 s, a third of the modelled before-number.
- Startup opens the 10 connections once (about 10 connect round trips). After a suspend that
  dropped every socket, the pre-ping discards the dead ones and the burst still succeeds.
- Idle pre-ping threshold left at 5 s. psycopg2 hands out the most recently returned
  connection first (`self._pool.pop()`), so light traffic keeps reusing one recently used
  connection and skips the ping. Only a burst after more than 5 s of quiet pings each
  connection, and those pings run in parallel. Raising the threshold would need a measured
  socket death window on Fly, which T4960 never measured.

Still to measure on staging after deploy: 12 parallel
`curl -H "Cookie: rb_session=probe-not-a-real-session" <api>/api/version`, before vs after.
Also confirm the staging Postgres `max_connections` holds 10 for the app plus 10 for the
release command's one-shot pool.

## Acceptance Criteria

- [ ] A recorded profile or timing shows where the serial wait was before the change.
- [ ] On staging, 12 simultaneous requests with an invalid sign-in cookie answer at least three times faster than the recorded before-number.
- [ ] The server starts and passes its health check from cold and after a suspend.
