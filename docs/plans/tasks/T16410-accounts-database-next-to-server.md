# T16410: Accounts database next to the server

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** The server that answers the app runs in Los Angeles. The accounts database it asks about sign-ins, sharing and admin numbers runs in Chicago. Staging is split the same way.

**The problem and how we got here.** Every question to the database crosses the country and back, about 45 milliseconds each time, and one sign-in check is about four questions. That is the 0.18 seconds we measured on every signed-in request on production on 2026-11-13, after the owner reported a stuck loading screen. The two were created in different places in May 2026 and nobody noticed, because each request alone still felt fast.

**What we will do.** Create a new, empty database in Los Angeles, copy the data across, and point the server at it. The old Chicago database stays untouched for a week as the way back. Staging goes first, as the rehearsal. Production is done in a quiet hour; sign-in and sharing are unavailable for about five minutes while the copy runs.

**Why this and not something else.** Three other ways were looked at and set aside. Moving the server to Chicago would put it further from the parents, who are mostly in California. Fly's own "move a database between regions" recipe needs three extra copies of the database, is no longer maintained by Fly, and their forum has several reports of it leaving a database with no working leader. A copy into a new database is slower by a few minutes but every step can be checked and undone. Fly's managed database would also work and is supported, but costs about 38 dollars a month against about 2 today; that is the owner's call and can be made later with the same copy steps.

**How we will know it worked.** The server's timing log shows the sign-in check falling from about 180 milliseconds to under 20 on a single request. Sign-in, a shared link and the admin dashboard all work, and the row counts of every table match the old database.

## Ruling

(owner, 2026-11-13) **Staging now, production later; Fly Postgres, same kind as today.** This task moves the staging accounts database to Los Angeles as the rehearsal and stops before production. It uses unmanaged Fly Postgres (`fly postgres create`, about 2 dollars a month), not Fly Managed Postgres. The production move, its window and the removal of both old databases are T16460, which the owner schedules after this lands and T16380/T16390 are on staging.

Scope for this task: runbook steps 2 to 7 on staging only (`reel-ballers-db-staging` to a new `reel-ballers-db-staging-lax`, API `reel-ballers-api-staging`). Staging is down for a few minutes during the copy; that is accepted. Keep the old staging database (do not destroy it). Never run a command with `-a reel-ballers-api` or `-a reel-ballers-db-prod`. Write what the rehearsal taught (times, surprises, exact commands) into T16460's file so production follows a tested script. If the container has no Fly credentials, stop with BLOCKED naming what it needs; do not work around it.

## Implementer details

Facts recorded 2026-11-13:

- `reel-ballers-api` (lax, one machine) and `reel-ballers-api-staging` (lax). `reel-ballers-db-prod` and `reel-ballers-db-staging`: one machine each in `ord`, image `flyio/postgres-flex:17.2`, 1 GB volume, shared-cpu-1x (512 MB prod, 256 MB staging), `PRIMARY_REGION=ord`. Database name `reel_ballers_api`. The API reaches it through the `DATABASE_URL` secret that `fly postgres attach` set (`*.flycast:5432`); the deploy scripts never push that secret.
- Fly's unmanaged Postgres docs are archived ("no longer maintained"). Their regional move: clone at least three replicas into the new region, redeploy the cluster with `PRIMARY_REGION` changed (read-only until the next step), then `fly pg failover`. Community threads report "no eligible masters" and clones stuck at health checks after this. Not used here.

Runbook (staging first, then production; every command with `-a` named explicitly):

1. Announce a window. Production: pick the quietest hour from the admin activity view.
2. `fly postgres create --name reel-ballers-db-prod-lax --region lax --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1 --image-ref flyio/postgres-flex:17.2`. Same major version as the source so the dump restores cleanly. Save the printed credentials.
3. Stop writes: `fly scale count 0 -a reel-ballers-api` (or stop its machine). Sessions, shares and analytics rows written after the dump would otherwise be lost.
4. Dump from the old database and restore into the new one from one place, for example a local shell with two `fly proxy` tunnels (`fly proxy 15432:5432 -a reel-ballers-db-prod`, `fly proxy 25432:5432 -a reel-ballers-db-prod-lax`): `pg_dump --no-owner --no-acl -Fc -d reel_ballers_api` then `pg_restore --no-owner -d reel_ballers_api`. The target database and the app's user are created by the attach in step 5, so run step 5 before the restore, restoring as that user.
5. `fly postgres detach reel-ballers-db-prod -a reel-ballers-api`, then `fly postgres attach reel-ballers-db-prod-lax -a reel-ballers-api --database-name reel_ballers_api`. Attach creates the user and sets the new `DATABASE_URL`. Detach removes the app's user from the old database but leaves its data.
6. Compare row counts for every table and the `schema_migrations` ledger between old and new.
7. Start the API again. Smoke test: sign in, open a shared link, load the admin dashboard, run the 12-at-once timing from T16380.
8. Way back, any time in the first week: stop the API, attach the old database again, start the API. Rows written to the new database in between would need copying back by hand, so decide within the first hour if anything looks wrong.
9. After a week: take a final `pg_dump` of the old database to R2, then `fly apps destroy reel-ballers-db-prod`. Update every doc and script that names the old app (`.claude/skills/deploy/SKILL.md`, `scripts/reset-test-user.py`, anything that greps for `db-prod`).

Notes:

- Destroying the old database and the production window are owner-confirmed steps; a headless worker prepares and rehearses on staging and stops before production.
- Do T16380 and T16390 first. They remove most of the pain without downtime, and after them this task is worth about 40 milliseconds on the calls that still reach the database, mainly sign-in and the admin screens.
- If the owner chooses Fly Managed Postgres instead, steps 3 to 9 are the same with `fly mpg create --region lax` and its connection string set as the `DATABASE_URL` secret by hand.
- Knowledge doc: `.claude/knowledge/backend-services.md`; update its Postgres section with the new app name and region.

## Acceptance Criteria

- [ ] C1: Staging's API and accounts database both run in Los Angeles, and every table's row count and the `schema_migrations` ledger match the old staging database at the switch.
- [ ] C2: On staging, a single signed-in request's session check takes under 20 ms in the timing log.
- [ ] C3: Sign-in, a shared link and the admin dashboard work on staging after the switch.
- [ ] C4: T16460's file holds the production runbook as rehearsed: each command, how long the copy took, and anything that differed from the plan above.
