# T8680: R2_ENABLED (and any import-time env read) could freeze to false regardless of .env

**Status:** STAGING
**Impact:** 8
**Complexity:** 2
**Created:** 2026-09-04

## Problem

User-reported live while testing T8390 on a fresh container: adding a game failed with
`R2 storage not enabled. Multipart upload requires R2.` even though `.env` had
`R2_ENABLED=true`.

Root cause traced and reproduced: `app/main.py` called `load_dotenv()` AFTER
`from app.migrations import BelowMigrationFloor, MigrationBlocked`. That import
transitively pulls in `app.storage` (`app.migrations` -> `.profile_db` RUNNER ->
`v023_repair_sourceless_active_games` migration file -> `app.storage`), and
`app/storage.py` reads `R2_ENABLED = os.getenv("R2_ENABLED", "false").lower() == "true"`
at MODULE IMPORT time. So on a fresh process start, `app.storage` module-level code ran
before `.env` had been loaded into `os.environ`, froze `R2_ENABLED = False` for the
process's entire life, and no later `load_dotenv()` call could undo it (Python caches
imported modules; the assignment already ran).

Confirmed via direct reproduction (`python3 -c "import app.main; import app.storage;
print(app.storage.R2_ENABLED)"` printed `False` while `os.environ['R2_ENABLED']` was
correctly `'true'` after `load_dotenv()` ran).

This is a general bug class, not R2-specific: ANY module-level `os.getenv()` read in a
module that gets transitively imported ahead of `main.py`'s `load_dotenv()` call is at
risk of the same freeze. It most likely only manifests on a genuinely fresh process start
(a long-lived dev server that happened to pick up the right value early, or an environment
where the var is set at the OS level rather than only via `.env`, would not show it) —
which is exactly why it went unnoticed until a freshly-cloned container hit it cold.

## Fix

Moved the `load_dotenv()` call in `src/backend/app/main.py` to run immediately after the
stdlib imports, BEFORE any `from app...` import (previously it ran after
`from app.migrations import ...`). No other behavior change.

## Evidence

- Direct reproduction: `app.storage.R2_ENABLED == False` after `import app.main` pre-fix,
  despite `os.environ['R2_ENABLED'] == 'true'`.
- Post-fix: `app.storage.R2_ENABLED == True`, matching `.env`.
- New regression test `tests/test_main_env_load_order.py` — static/structural check that
  `load_dotenv()` precedes every `from app...` import in `main.py` (a subprocess-based
  functional test would need `.env` to exist identically in CI, which isn't guaranteed).
  Encodes the exact invariant that prevents this bug class from recurring for any future
  module-level env read, not just `R2_ENABLED`.
- `from app.main import app` sanity check (required by `src/backend/CLAUDE.md`) passes clean.

## Acceptance Criteria

- [x] `R2_ENABLED` correctly reflects `.env` on a fresh process start
- [x] Regression test added, passing
- [x] `from app.main import app` sanity check passes
