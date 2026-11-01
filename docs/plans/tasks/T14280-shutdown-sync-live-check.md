# T14280: The deploy-shutdown sync can't be exercised in a running dev stack

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** S
**Created:** 2026-11-01
**Updated:** 2026-11-01

Found while landing T14150 (2026-11-01).

## Problem

T14150 changed which DBs are uploaded when Fly sends SIGTERM at deploy:
- DBs with a pending marker go first, then DBs changed since their last restore or upload.
- Everything must finish inside `kill_timeout` (30 s).

The SIGTERM handler is registered only when `not IS_DEV` (`main.py`), so the path can't be
driven live in dev or in a /dotask container. Today its only coverage is the T4320 integration
test: the real app and SQLite, against a fake R2. Nothing checks the real thing:
- a live uvicorn process receiving a real signal
- real R2 CAS
- the real 30 s budget

## Solution

Choose one:
- A dev opt-in env var (e.g. `SHUTDOWN_SYNC_IN_DEV=1`) that registers the handler in dev, plus
  a script that writes to a DB outside a request, sends SIGTERM to uvicorn, and checks the R2
  version moved.
- Or a staging-gate step that does the same against staging and checks the logs for the
  "synced N DB(s)" line and no CRITICAL.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/main.py` - `_sync_pending_dbs_on_shutdown`, `_scopes_to_sync`, handler registration
- `src/backend/tests/test_shutdown_sync_pending.py`
- `scripts/staging-gate.sh` (if the staging option is chosen)

### Related Tasks
- Depends on: T14150 (landed in PR #689)

## Acceptance Criteria

- [ ] One command drives a real SIGTERM against a running backend and reports which DBs were uploaded
- [ ] A DB written outside a request before the signal shows a newer R2 version afterwards
