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
(`now` injectable for tests; returns the plan/results — the admin endpoint reuses it.)

1. **Candidates** — one query: users whose `created_at` puts them inside ANY step window
   (EPIC §1: due = `created_at + N days`, expires = due + 48h, N ∈ {1,3,7,14}) LEFT JOIN
   `drip_sends` to exclude already-claimed `(user_id, drip_day)` pairs. LEFT JOIN
   `user_segments` (nullable — T4970 lesson: segmentless users still exist and still get
   drips; only `users.created_at` is required).
2. **Suppression** (EPIC §6, checked in this order, cheapest first): email pattern
   (`@test.local` / `@e2e.local`), `DRIP_SUPPRESSED_EMAILS` env list, `is_admin`,
   `is_unsubscribed`. Suppressed users get NO `drip_sends` row (they're permanently
   filtered, not one-time skipped — writing rows for them would just be noise).
3. **Stage** — aggregate `user_actions` per candidate (one grouped query for the whole
   batch, `user_id = ANY(%s)`, same shape as `admin.py:list_users`), then
   `drip_engine.resolve_stage`.
4. **Template** — `select_template(day, stage)`. `None` → record `skipped` with detail
   (`disabled` / `absent`) — the row still claims the slot so the cell isn't re-evaluated
   every tick.
5. **Claim** — `INSERT INTO drip_sends (user_id, drip_day, stage, template_id, status)
   VALUES (%s,%s,%s,%s,'claimed') ON CONFLICT (user_id, drip_day) DO NOTHING RETURNING id`.
   No row returned = another tick/machine won; stop.
6. **Render + send** — `build_context` → `render_template` → `send_drip_email` (with
   per-user unsubscribe URL). Update the claim row: `sent` + `sent_at`, or `failed` +
   detail. `DripRenderError` and transport failure both → `failed`, CRITICAL log, claim
   kept (no auto-retry — EPIC §4).
7. **Dry-run** short-circuits between steps 4 and 5: returns
   `[{user_id, email, drip_day, stage, template_id, subject}]` — no claims, no sends, no
   writes at all.

Sends are sequential (the manual campaign's scale — single-digit users per tick — makes
concurrency pointless; revisit only with evidence).

### Admin endpoint: `POST /api/admin/drip/run`
Body `{dry_run: bool = true}`. `_require_admin()`. Dry-run returns the plan; live run
executes one tick immediately (same `run_drip_tick`) and returns results. This is the
staging/prod verification tool (EPIC rollout steps 1–2) and the manual-retry path for
`failed` rows is deliberately NOT built (delete the row via SQL if a resend is truly wanted
— an admin gesture, not a button, until there's evidence it's needed).

Also `GET /api/admin/drip/sends?limit=100` — recent send-log rows for T7270's log view
(plain SELECT, newest first, joined to `users.email` + template subject).

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
- **Multi-machine safety comes ONLY from the claim** (unique constraint), never from "we
  run one machine" — prod is 1 box today but T5950 documents that assumption as temporary.
- Windows math in SQL against `now()`, half-open: `now() >= created_at + INTERVAL 'N days'
  AND now() < created_at + INTERVAL 'N days' + INTERVAL '48 hours'`.
- A user due MULTIPLE steps in one tick (impossible with 48h windows and these offsets, but
  assert it): process only the LOWEST due day this tick.
- Test the claim race: two concurrent `run_drip_tick` calls → exactly one `sent` row
  (thread the two calls; the DB constraint is the arbiter).
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

- [ ] Double tick / concurrent ticks: exactly one email per (user, step) — DB-proven
- [ ] Dry-run writes nothing (assert row counts unchanged) and reports the exact plan
- [ ] User active 20 days pre-launch: zero candidates
- [ ] Suppressed (each rule) and unsubscribed users: never claimed
- [ ] `DRIP_EMAILS_ENABLED` unset → entrypoint exits 0 without touching the DB; set → one full tick
- [ ] Scheduled machine exists per env, runs the entrypoint daily in isolation from app servers, and `deploy_production.sh` updates its image on deploy
- [ ] Progressing user gets new-stage copy at the next step (integration test across two frozen times)
- [ ] Tests pass (relevant set)
