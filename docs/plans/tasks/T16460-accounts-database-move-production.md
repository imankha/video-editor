# T16460: Move the production accounts database to Los Angeles

**Status:** WAITING ON USER
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-13
**Updated:** 2026-11-15

## In plain words

**Today.** Production's server runs in Los Angeles and its accounts database in Chicago, so every database question crosses the country (about 45 ms each, about 0.18 s per signed-in request measured 2026-11-13). T16410 moves staging's database first, as the rehearsal.

**What we will do.** Repeat T16410's rehearsed steps on production in a quiet hour the owner picks: create `reel-ballers-db-prod-lax` (Fly Postgres, same kind as today), stop the API, copy the data, attach the new database, check row counts, start the API. Sign-in and sharing are down for about five minutes. The old Chicago database stays for a week as the way back, then is backed up to R2 and removed. The old staging database goes at the same time.

**Why.** Owner ruling 2026-11-13 on T16410: staging now, production later, after T16380 and T16390 (which remove most of the slowness without downtime) are on staging.

**How we will know it worked.** The session check falls to under 20 ms on a single request in production's timing log; sign-in, a shared link and the admin dashboard work; every table's row count matches.

## Ruling needed

- [ ] human: the owner picks the production window and confirms the removal of the old databases after a week.

## Runbook

Rehearsed on staging 2026-11-14 by T16410 (`reel-ballers-db-staging` in ord to `reel-ballers-db-staging-lax`, API `reel-ballers-api-staging`). flyctl v0.5.10, Postgres client 17. Staging was down 3 min 11 s (16:04:59 to 16:08:10 UTC); about 90 s of that went on the two surprises in steps 4a and 4b, so production should be down about 2 minutes. Staging data: 11 MB, 31 tables; dump 11 s, restore 6.5 s.

Every command names its app with `-a`. Run them from one shell that has flyctl, `FLY_API_TOKEN` and `pg_dump`/`pg_restore`/`psql` 17. Keep the scratch directory (`$D`) outside the repo: it holds passwords and the dump.

0. Read-only check first, at window time: `fly postgres db list -a reel-ballers-db-prod`. On staging the database was named `reel_ballers_api_staging` (attach names it after the app), not `reel_ballers_api` as T16410 assumed. Use the real name everywhere `$DB` appears below; production is expected to be `reel_ballers_api`.
1. Pick the window from the admin activity view and announce it.
2. Create the new database (took about 20 s on staging; it may warn that image 17.7 exists, keep 17.2 to match the source):
   `fly postgres create --name reel-ballers-db-prod-lax --org personal --region lax --initial-cluster-size 1 --vm-size shared-cpu-1x --vm-memory 512 --volume-size 1 --image-ref flyio/postgres-flex:17.2 > $D/create.log`
3. Stop writes. Stopping the machine is not enough: `auto_start_machines = true` restarts it on the next request. Cordon it first (requests then fail at the edge instead of waking it), then stop it. Production has `min_machines_running = 1`; cordon + stop still works, since a stopped machine is only restarted by the proxy.
   `fly machine list -a reel-ballers-api` (note the id), then `fly machine cordon <id> -a reel-ballers-api` and `fly machine stop <id> -a reel-ballers-api`. Confirm with `curl https://<api host>/api/health` that it does not answer and `fly machine status <id> -a reel-ballers-api` still says stopped.
4. Dump the old database.
   a. The password of the `postgres` user is the database machine's `OPERATOR_PASSWORD`, not `SU_PASSWORD` (that one belongs to `flypgadmin`; the first try on staging failed authentication):
      `fly ssh console -a reel-ballers-db-prod -C printenv | tr -d '\r' | sed -n 's/^OPERATOR_PASSWORD=//p' > $D/old_pw`
   b. Tunnel and dump (use `127.0.0.1`, not `localhost`: the proxy listens on IPv4 only):
      `fly proxy 15433:5432 -a reel-ballers-db-prod &`
      `PGPASSWORD=$(cat $D/old_pw) pg_dump -h 127.0.0.1 -p 15433 -U postgres --no-owner --no-acl -Fc -d $DB -f $D/prod.dump`
   c. Record every table's row count and the ledger from the old database while writes are stopped. T16410's counting loop: for each `schemaname||'.'||tablename` in `pg_tables` outside `pg_catalog`/`information_schema`, `select count(*)`; then `select * from schema_migrations order by 1`. Save it as `$D/counts_old.txt`.
5. Switch the attachment.
   a. `fly postgres detach` and `attach` ask which attachment to use even when there is only one, and they have no `--yes` for that question. Headless they fail with `Error: prompt: non interactive`; give them a terminal:
      `printf '\r' | script -qec "fly postgres detach reel-ballers-db-prod -a reel-ballers-api" /dev/null`
      Detach drops the app's user from the old database (its tables belong to `postgres`, so the data stays) and STAGES the removal of `DATABASE_URL`.
   b. `printf 'y\r' | script -qec "fly postgres attach reel-ballers-db-prod-lax -a reel-ballers-api --database-name $DB" /dev/null > $D/attach.log`
      Attach creates the database and the app's user (superuser by default) and STAGES the new `DATABASE_URL` (shown as `Staged` in `fly secrets list`). Nothing restarts, so the API never starts against the empty database. The new URL, with the user's password, is printed in `$D/attach.log`.
6. Restore as the app's user and compare:
   `fly proxy 25433:5432 -a reel-ballers-db-prod-lax &`
   `PGPASSWORD=<password from attach.log> pg_restore --no-owner --no-acl -h 127.0.0.1 -p 25433 -U <app user from attach.log> -d $DB $D/prod.dump`
   The target had 0 tables, so no `--clean` was needed and the restore printed no errors. Run the same counting loop against the new database into `$D/counts_new.txt`; `diff $D/counts_old.txt $D/counts_new.txt` must print nothing (staging: identical, 31 tables and 47 ledger rows).
7. Start the API:
   `fly secrets deploy -a reel-ballers-api` (applies the staged `DATABASE_URL`; took 3 s), `fly machine uncordon <id> -a reel-ballers-api`, `fly machine start <id> -a reel-ballers-api`. The first request after the start took 10 s on staging (cold start); after that `/api/health` answered in under 0.1 s.
8. Smoke test. Sign in, open a shared link, load the admin dashboard, run the 12-at-once timing from T16380. The session check is the `auth_ms` field of the `[REQ_TIMING] GET /api/auth/me` log line. `fly logs --no-tail` only holds a few lines; stream `fly logs -a reel-ballers-api` while making the requests. Staging after the move: `auth_ms` 8 to 9, 17 on the first request after sign-in. `scripts/t16410_staging_db_check.sh` does all of this for staging; copy it with the production app names.
9. Tell the owner: their `.env.prod` `DATABASE_URL` (used with `fly proxy 15433:5432` by the deploy, email and BI scripts) carries the old user's password, which no longer works. They read the new one with `fly ssh console -a reel-ballers-api -C printenv DATABASE_URL` and swap the host for `localhost:15433`. Same for `.env.staging` after the staging move. Point every doc and script that names `reel-ballers-db-prod` at `reel-ballers-db-prod-lax` in the same change (T16410 did this for staging).
10. Way back, first week: cordon and stop the API, `fly postgres detach reel-ballers-db-prod-lax -a reel-ballers-api`, `fly postgres attach reel-ballers-db-prod -a reel-ballers-api --database-name $DB` (recreates the dropped user), `fly secrets deploy`, uncordon, start. Rows written to the new database meanwhile need copying back by hand.
11. After a week (owner-confirmed): `pg_dump` each old database to R2, then `fly apps destroy reel-ballers-db-prod` and `fly apps destroy reel-ballers-db-staging`.

Differences from T16410's plan: the database name (step 0), stopping writes with cordon instead of `fly scale count 0` (step 3), the operator password (step 4a), the prompts (step 5a), staged secrets plus `fly secrets deploy` (steps 5 and 7), and the local `.env` passwords (step 9). The order was step 4 dump, then 5 detach/attach, then restore: attach must exist before the restore so the restore runs as the app's user.

## Acceptance Criteria

- [x] C1: Production's accounts database runs in Los Angeles; every table's row count and the `schema_migrations` ledger match the old one at the switch.
- [ ] C2: Sign-in, a shared link and the admin dashboard work after the switch; the session check takes under 20 ms on a single request.
- [ ] C3: After a week, a final dump of each old database is in R2, both old database apps are destroyed, and no doc or script names them.
