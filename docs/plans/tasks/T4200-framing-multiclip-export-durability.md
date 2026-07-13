# T4200: Framing/Multi-Clip Export Durability (sync-then-announce)

**Status:** DONE
**Impact:** 9
**Complexity:** 3
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) item B1)

## Problem

**Exposure: export pipeline = monetization core (GPU credits) + the product's payoff moment (retention).** This is the same bug class T4110 fixed for overlay exports and already lost user data on prod once.

Framing and multi-clip exports announce `COMPLETE` to the user **before** the profile DB is durably synced to R2, and ignore sync failure entirely. If the Fly machine dies (deploy, stop, crash) after the announce but before the sync:

- The UI has already moved the user to Overlay, but on the next request another machine loads the pre-export DB — the project has **no working video** and `exported_at` is unset.
- Worse: because `exported_at` is unset, the next full-state PUT overwrites the working clip **in place** instead of creating a new version — silently weakening the T4020 shadow-version guard too.

There is also a phantom-success bug: multi-clip catches a DB-save exception, logs it, and **still announces "Export complete!"** — the user sees success, an R2 video object exists, but there is no DB row pointing at it (same family as the T4010 lost-references incident).

## Root Cause (verified)

- `src/backend/app/routers/export/multi_clip.py:1440-1448` (Modal branch) and `:1737` (local branch): COMPLETE event sent inside the pipeline.
- `src/backend/app/routers/export/framing.py:718-722` and `multi_clip.py:2298-2301`: `sync_export_db_to_r2` runs in a `finally` block *after* the announce, return value unchecked.
- `multi_clip.py:1436-1437`: `except` around the DB save logs and continues to the success broadcast.
- The correct pattern already exists for overlay: `src/backend/app/routers/export/overlay.py:2122-2129`, `:2189-2196`, `:1907-1927` (sync **then** announce, with `_export_sync_failed_data` at `overlay.py:199-212` producing a retryable `sync_failed` event). `services/export_helpers.py:347-349` — `sync_export_db_to_r2`'s own docstring says callers must gate the COMPLETE event on it.

## Solution

Copy the overlay pattern, don't invent a new one:

1. In both framing and multi-clip pipelines, call `sync_export_db_to_r2(...)` **before** broadcasting COMPLETE.
2. If the sync fails, broadcast the same `sync_failed` payload overlay uses (`_export_sync_failed_data`) so the frontend's existing retry UX (built in T4110) works — do NOT invent a new event shape. Move/share that helper (e.g., into `export_helpers.py`) rather than importing router→router.
3. In `multi_clip.py:1436-1437`: a DB-save failure is **terminal** — mark the job failed (`fail_export_job`), broadcast the error, and return failure. Never announce success after a swallowed exception.
4. The `finally`-block syncs can stay as a best-effort backstop, but the announce must no longer depend on them.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/export/multi_clip.py` — both COMPLETE sites, the swallowed DB-save except, the finally-sync
- `src/backend/app/routers/export/framing.py` — finally-sync at :718-722; find its announce site(s)
- `src/backend/app/routers/export/overlay.py` — the reference implementation (read `:1907-1927` and `_export_sync_failed_data` first, before writing any code)
- `src/backend/app/services/export_helpers.py` — `sync_export_db_to_r2`

### Related Tasks
- T4110 (DONE) — built sync-then-announce for overlay + the frontend `sync_failed` retry UX; this task extends the same boundary to the two remaining export types
- T4120 (DONE) — gives you `FORCE_R2_SYNC_FAILURE` and machine-cycle simulation seams for testing this in a /dotask container

### Technical Notes
- Do not hold the announce hostage to a *slow* sync forever — overlay already solved the timeout/UX question; mirror its behavior exactly.
- T2720 history: a 14s R2 upload lock once froze the UI post-export. The sync you're gating on is the same operation — keep it off the request path (it already runs in the worker/pipeline context) and change ordering only, not threading.

## Implementation

### Steps
1. [ ] Read overlay.py's sync-then-announce flow end-to-end; write down the exact event payloads it sends on success and on sync failure.
2. [ ] Test first (bug-reproduction skill): backend test with `FORCE_R2_SYNC_FAILURE` asserting framing/multi-clip export does NOT emit COMPLETE and DOES emit `sync_failed`.
3. [ ] Test: multi-clip DB-save exception → job marked failed, error broadcast, no COMPLETE.
4. [ ] Implement (framing, then multi-clip Modal branch, then local branch).
5. [ ] Run `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"` + backend export tests.
6. [ ] In-container live verify (T4120 recipe): local-render export with forced sync failure → UI shows retry, not success.

## Acceptance Criteria

- [ ] No export type announces COMPLETE before its R2 sync has succeeded
- [ ] Sync failure produces the same retryable `sync_failed` UX as overlay exports
- [ ] Multi-clip DB-save failure is terminal (failed job, no success broadcast)
- [ ] No new router→router imports (shared logic lives in export_helpers)
