# T13960: Branch CI backend job selects tests by recorded coverage (pytest-testmon)

**Status:** OBSOLETE (user decision 2026-10-29: not adopted as specified; hardened follow-ups T13961, T13962)
**Impact:** 7
**Complexity:** 6
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Branch CI's backend job runs the whole pytest suite (`python -m pytest tests/test_*.py`,
`.github/workflows/branch-ci.yml` backend job) for any `src/backend/**` change. The user wants
only the tests reachable from the change. Choosing tests by file path is unsound in this codebase:
nearly every test imports `app.main`, so a `storage.py` change is exercised by tests that never
mention storage (reason per-file selection was rejected on 2026-08-03, T6405). Sound selection
needs runtime coverage data.

## Solution

Adopt `pytest-testmon`:
1. Master CI runs the full suite with `--testmon` and saves `.testmondata` as a cache/artifact
   keyed to the master SHA.
2. Branch CI restores the latest master `.testmondata`, then runs `pytest --testmon` (plus the
   same deselects), so only tests whose recorded coverage touches changed code run.
3. Fallback to the full suite (bias toward RUNNING) when: no usable baseline exists; the
   baseline SHA is not an ancestor of the branch base; dependencies changed
   (`requirements*.txt`, `pyproject`, `conftest.py`, pytest config); a migration or
   `_SCHEMA_DDL` changed; or a non-Python input the tests read at runtime changed (see
   `CROSS_TREE_READS` in `scripts/ci_policy.py`, `formal annotations/test.short/`).
4. Lint, ruff baseline, and the `from app.main import app` import check stay full.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/branch-ci.yml`, `.github/workflows/master-ci.yml` - pytest steps, cache save/restore
- `src/backend/requirements*.txt` - add pytest-testmon
- `src/backend/run_tests.py` - keep the canonical selection in sync
- `scripts/ci_policy.py`, `scripts/test_ci_policy.py` - emit the full-suite fallback flag
- `docs/testing/known-failures.md` - deselects must still apply
- `CLAUDE.md` (Test Scope Policy), `.claude/skills/run-tests/SKILL.md`

### Related Tasks
- Sibling: T13950 (frontend vitest related), T13970 (router fan-out)
- `pytest tests/` capture crash is tracked in T5000; testmon must work with `--capture=sys`

### Technical Notes
- testmon tracks Python line coverage. It does NOT see data files, env vars, Postgres/SQLite
  schema state, or subprocess-executed scripts (`scripts/delete_user.py` etc.). Every such
  input needs an explicit full-run trigger.
- Check the cost of the coverage-instrumented run on master (expect +20-40% time) and the cache size.
- Measure on recent backend PRs: selected vs full, and replay any Master CI post-merge
  failure to confirm testmon would have selected it.

## Acceptance Criteria

- [ ] Master CI publishes a testmon baseline per merge
- [ ] A backend change in Branch CI runs only the testmon-selected tests; the log lists them
- [ ] Every fallback trigger above forces a full run, covered by `test_ci_policy.py`
- [ ] Replaying a past Master-CI-only regression shows it would be selected
- [ ] Docs updated

## Outcome (2026-10-29): not adopted; Branch CI keeps the full backend suite

The prototype was built and then reverted at the user's call (option C), with the
hardening split into T13961 and T13962 (option B). The reverted prototype is
`T13960-testmon-prototype.patch.gz` in this folder (`zcat <file> | git apply` on the
T13950 head). It adds `ci_policy.pytest_plan`/`pytest_selection`/`import_time_change`,
a `pytest-plan` CLI, both workflows, and `scripts/test_ci_testmon_selection.py`
(20 tests).

### Why it was not shipped

testmon (2.2.0, coverage 7.17) links a test to a file only if the test executed a
line of it. Reproduced in throwaway repos (by this task and by an independent expert
review), a test is NOT selected when what changed is:
- a module-level value it consumes without running a line of that file: constants,
  pydantic/dataclass class bodies, `from consts import X` copied into another module;
- a function body that runs at import (`X = build()`, decorator registries, class
  attributes computed by a call, `__init_subclass__`);
- code run once per process or module (`lru_cache`, module/session fixtures,
  `ensure_database` via `_initialized_users`, `get_r2_client`): credited only to the
  first test that ran it;
- code on a thread that existed before coverage restarted. testmon restarts coverage
  every 250 tests (`TEST_BATCH_SIZE`) and `Collector.start()` only traces the current
  and later threads, so a module-scoped `with TestClient(app)` loses its endpoint
  coverage after a boundary (about 17 boundaries per full run);
- code in the app's own process pool (`app/services/modal_client.py`
  `_run_in_subprocess`), reached through the API.

Other traps found: testmon leaves its data in `.testmondata-wal` (saving only
`.testmondata` gives an empty baseline; checkpoint with
`PRAGMA wal_checkpoint(TRUNCATE)` first); passing a directory lets testmon skip
collection and turn an import error into exit 0 (pass the `tests/test_*.py` file list);
the installed-package fingerprint includes unpinned `ruff`/pip/setuptools, so any drift
silently re-runs everything; `-p no:cacheprovider` crashes testmon 2.2.0.

### Measured payoff

The prototype's fallback rules (full suite on any import-time change, schema or
migration file, non-Python input, conftest, deleted module), replayed over the last
80 master commits touching `src/backend`: **20 testmon, 60 full** (reasons:
module-level change 79, schema/migration 23, non-Python input 19, new module 5,
deleted 3). Past Master-CI-only backend regression `b1f1dd20` (fixed by `d4e70cc21`)
plans `full`, so it would have been caught.
