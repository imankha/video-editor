# T7260: Drip Scheduler + Idempotent Send Pipeline + Admin Dry-Run

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-19
**Updated:** 2026-08-19

Epic task 4/5 — see [EPIC.md](EPIC.md) §1 (windows), §4 (claim-then-send), §5 (scheduler
pattern), §6 (suppression). Depends on T7230 (tables), T7240 (engine), T7250
(`send_drip_email`, `is_unsubscribed`).

## Problem

The part that actually runs: a background loop that periodically finds users due a drip
step, resolves their stage, and sends — with at-most-once delivery guaranteed by the DB, an
admin dry-run to inspect the plan before anything is live, and env gates so nothing sends
until deliberately enabled.

## Solution

### Tick: Fly scheduled machine + one-shot entrypoint (EPIC §5, revised)
NO in-process loop, NO `main.py` lifespan hooks (see EPIC §5 for the full rejection
rationale: suspend-fighting keepalives, N redundant ticks on a scaled fleet, and shared
fate with request serving on a box that has already OOM'd once).

- `app/drip_tick.py` — one-shot entrypoint: if `os.getenv("DRIP_EMAILS_ENABLED") != "true"`,
  log one INFO line and exit 0 (the kill switch); else `run_drip_tick()`, log the result
  summary, exit (non-zero on unhandled exception so the failed run is visible in
  `fly machine` status/logs).
- Created once per env:
  `fly machine run <image> --schedule daily -a reel-ballers-api --vm-memory 512 "python -m app.drip_tick"`
  (staging: `-a reel-ballers-api-staging`). Record the machine id in the task file's
  Progress Log.
- **Deploy integration (required, same task):** `deploy_production.sh` gains a
  `fly machine update <machine-id> --image <new-ref>` step — `fly deploy` does not update
  machines created via `fly machine run`, and a stale-image tick would run old code
  against a new schema. The deploy skill doc gets the same note.
- The admin endpoint below is the manual trigger and the dry-run tool; the DB claim makes
  any overlap between it and the scheduled machine safe.

### Pipeline: `run_drip_tick(now=None, dry_run=False) -> list[dict]`
(`now` injectable for tests; returns the plan/results.) Storage per EPIC §3: claims/log in
`drip.sqlite` (this process is its ONLY writer); templates + unsubscribe markers read from
R2 via T7230's `drip_store`. Postgres is READ-ONLY here (existing tables only).

0. **Load state** — download `drip/drip.sqlite` from R2 (note its etag), fetch
   `drip/templates.json`, list `drip/unsubscribed/` into a set.
1. **Candidates** — one Postgres READ: users whose `created_at` puts them inside ANY step
   window (EPIC §1: due = `created_at + N days`, expires = due + 48h, N ∈ {1,3,7,14}).
   LEFT JOIN `user_segments` (nullable — T4970 lesson: segmentless users still exist and
   still get drips; only `users.created_at` is required). Already-claimed
   `(user_id, drip_day)` pairs are filtered against the LOCAL `drip_sends` table.
2. **Suppression** (EPIC §6, cheapest first): email pattern (`@test.local` /
   `@e2e.local`), `DRIP_SUPPRESSED_EMAILS` env list, `is_admin`, unsubscribe-marker set.
   Suppressed users get NO `drip_sends` row (permanently filtered, not one-time skipped).
3. **Stage** — aggregate `user_actions` per candidate (one grouped READ for the whole
   batch, `user_id = ANY(%s)`, same shape as `admin.py:list_users`), then
   `drip_engine.resolve_stage`.
4. **Template** — `select_template(templates_doc, day, stage)`. `None` → record `skipped`
   with detail (`disabled` / `absent`) — the row still claims the slot so the cell isn't
   re-evaluated every run.
5. **Claim batch + upload** — INSERT all `claimed`/`skipped` rows locally
   (`INSERT OR IGNORE`, UNIQUE(user_id, drip_day)), then **upload `drip.sqlite` to R2
   (etag-asserted) BEFORE any email is sent** — the crash-safety ordering from EPIC §4. An
   etag mismatch means a second writer exists: ABORT the whole run with a CRITICAL log,
   send nothing (should be impossible — single machine — so treat it as an incident, not a
   retry).
6. **Render + send** — `build_context` → `render_template` → `send_drip_email` (per-user
   unsubscribe URL). Update each row: `sent` + `sent_at`, or `failed` + detail
   (`DripRenderError` and transport failure both → `failed`, CRITICAL log, claim kept, no
   auto-retry). Final upload of `drip.sqlite` when the batch completes.
7. **Dry-run** short-circuits before step 5: returns
   `[{user_id, email, drip_day, stage, template_key, subject}]` — no claims, no sends, no
   writes, no uploads.

Sends are sequential (single-digit users per run at current scale; revisit only with
evidence).

### Admin endpoints (dry-run + log — READ-ONLY, EPIC §5)
- `POST /api/admin/drip/run` — **dry-run only** (reject `dry_run: false` with 400 and a
  pointer to the real trigger). Runs steps 0–4 read-only on the app server and returns the
  plan. There is deliberately NO app-server code path that executes sends — that would add
  a second writer to `drip.sqlite`. **Manual live run = `fly machine start
  <tick-machine-id>`** (same machine as the schedule ⇒ Fly won't double-start ⇒
  single-writer holds).
- `GET /api/admin/drip/sends?limit=100` — downloads a read-only COPY of
  `drip/drip.sqlite` (precedent: `share_view_counts` reads per-user SQLite server-side),
  returns recent rows newest-first joined to `users.email`. Never opens the tick's live
  file; never writes.
- Failed-row retry is deliberately NOT built (delete the row in the sqlite via an admin
  gesture if a resend is truly wanted, until there's evidence a button is needed).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/drip_pipeline.py` — NEW (`run_drip_tick` + candidate/suppression/claim logic)
- `src/backend/app/drip_tick.py` — NEW (one-shot scheduled-machine entrypoint)
- `scripts/deploy_production.sh` — add the `fly machine update --image` step
- `src/backend/app/routers/admin.py` — the two endpoints (small; the real logic lives in
  the service — respects the T5940 don't-grow-admin concern as much as practical)
- `src/backend/tests/test_drip_pipeline.py` — NEW

### Related Tasks
- Depends on: T7230 (tables), T7240 (engine), T7250 (send + unsubscribe check)
- Blocks: T7270 (UI consumes the endpoints)

### Technical Notes
- **At-most-once = single-writer discipline + claim-upload-before-send ordering** (EPIC
  §4). The etag assertion on upload is the tripwire that turns an accidental second writer
  into a loud abort instead of a silent merge — same philosophy as the user-DB CAS, but
  implemented standalone (this file must never enter the per-user sync machinery).
- App-fleet size is irrelevant by construction: app servers never write `drip.sqlite`.
- Windows math in SQL against `now()`, half-open: `now() >= created_at + INTERVAL 'N days'
  AND now() < created_at + INTERVAL 'N days' + INTERVAL '48 hours'` (a READ of existing
  Postgres tables — zero new PG fields/rows, user directive 2026-08-19).
- A user due MULTIPLE steps in one run (impossible with 48h windows and these offsets, but
  assert it): process only the LOWEST due day this run.
- Crash-ordering test: simulate death between claim-upload and send (kill after step 5) →
  next run sends NOTHING for those users; rows sit `claimed` in the log.
- Freeze-time tests via the injectable `now` — no sleeping tests.
- Backend tests TRUNCATE dev Postgres — warn first (memory `feedback_tests_wipe_dev_db`).
- The 20-days-old-user case (all windows expired) must yield zero candidates — the EPIC's
  no-catch-up-blast guarantee, as a test.

## Implementation

### Steps
1. [ ] `run_drip_tick` with injectable `now` + candidate/window query
2. [ ] Suppression chain + tests (each rule independently)
3. [ ] Claim-then-send + race test + failed-keeps-claim test
4. [ ] `app/drip_tick.py` entrypoint + `DRIP_EMAILS_ENABLED` kill switch + scheduled machine created per env + deploy-script image-update step
5. [ ] Admin run/sends endpoints + dry-run zero-writes test
6. [ ] Staging verification: dry-run plan inspected against staging users (all suppressed → empty plan is the expected result; seed one fake non-suppressed user to see a real plan row)

### Progress Log

## Acceptance Criteria

- [ ] Repeated runs: exactly one email per (user, step); crash between claim-upload and
      send never double-sends (kill-injection test)
- [ ] Etag mismatch on upload aborts the run loudly with zero sends
- [ ] Dry-run writes nothing (no claims, no uploads) and reports the exact plan;
      `dry_run: false` on the app-server endpoint is rejected
- [ ] User active 20 days pre-launch: zero candidates
- [ ] Suppressed (each rule) and unsubscribed users: never claimed
- [ ] `DRIP_EMAILS_ENABLED` unset → entrypoint exits 0 without touching the DB; set → one full tick
- [ ] Scheduled machine exists per env, runs the entrypoint daily in isolation from app servers, and `deploy_production.sh` updates its image on deploy
- [ ] Progressing user gets new-stage copy at the next step (integration test across two frozen times)
- [ ] Tests pass (relevant set)
