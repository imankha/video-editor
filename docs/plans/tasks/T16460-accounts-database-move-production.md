# T16460: Move the production accounts database to Los Angeles

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** Production's server runs in Los Angeles and its accounts database in Chicago, so every database question crosses the country (about 45 ms each, about 0.18 s per signed-in request measured 2026-11-13). T16410 moves staging's database first, as the rehearsal.

**What we will do.** Repeat T16410's rehearsed steps on production in a quiet hour the owner picks: create `reel-ballers-db-prod-lax` (Fly Postgres, same kind as today), stop the API, copy the data, attach the new database, check row counts, start the API. Sign-in and sharing are down for about five minutes. The old Chicago database stays for a week as the way back, then is backed up to R2 and removed. The old staging database goes at the same time.

**Why.** Owner ruling 2026-11-13 on T16410: staging now, production later, after T16380 and T16390 (which remove most of the slowness without downtime) are on staging.

**How we will know it worked.** The session check falls to under 20 ms on a single request in production's timing log; sign-in, a shared link and the admin dashboard work; every table's row count matches.

## Ruling needed

- [ ] human: the owner picks the production window and confirms the removal of the old databases after a week.

## Runbook

To be written by T16410 from the staging rehearsal (commands, timings, surprises). Starting point: T16410's runbook steps 1 to 9.

## Acceptance Criteria

- [ ] C1: Production's accounts database runs in Los Angeles; every table's row count and the `schema_migrations` ledger match the old one at the switch.
- [ ] C2: Sign-in, a shared link and the admin dashboard work after the switch; the session check takes under 20 ms on a single request.
- [ ] C3: After a week, a final dump of each old database is in R2, both old database apps are destroyed, and no doc or script names them.
