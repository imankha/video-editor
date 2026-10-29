# T13961: Master CI records a hardened testmon baseline

**Status:** TODO
**Impact:** 4
**Complexity:** 6
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

T13960 found that a plain `pytest --testmon` baseline misses dependencies that Branch CI
selection would need: coverage restarts every 250 tests and loses pre-existing threads
(module-scoped `TestClient` fixtures), import-time function bodies are credited to no test,
and process-pool or subprocess code is invisible. See the Outcome section of
[T13960](T13960-ci-backend-pytest-testmon.md) for the reproductions.

## Solution

Master CI's backend job produces a baseline that T13962 can trust, saved as one cache
entry keyed `testmon-<master sha>`:
1. Start fresh (`rm -f .testmondata*`), run `pytest --testmon tests/test_*.py` (file list,
   never a directory), and checkpoint the WAL (`PRAGMA wal_checkpoint(TRUNCATE)`,
   `journal_mode=DELETE`) before saving. Save only when the suite is green.
2. A `-p` plugin sets `testmon.testmon_core.TEST_BATCH_SIZE` to effectively unlimited and
   fails loudly if the attribute is gone (testmon upgrade).
3. Record import-time lines: under `coverage run`, `pytest --collect-only tests/test_*.py`
   plus importing every module under `app/` (`pkgutil.walk_packages`), failing on any
   error; save the executed lines next to the baseline.
4. The same plugin records which test was running when `ProcessPoolExecutor.submit`,
   `os.fork`/`posix_spawn` or a Python `subprocess.Popen` happened; save as
   `always_run.json`. This replaces the source-regex guess (78 of 428 files).
5. Pin the exact Python version; add `pytest-testmon==2.2.0` to
   `src/backend/requirements.test.txt`; set
   `testmon_ignore_dependencies = pip setuptools wheel ruff` in `pytest.ini`.

Go/no-go first: measure the master run's extra time, memory and cache size with the
batch-size patch. If the cost is not affordable, stop and report.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/master-ci.yml` - backend job: record and save the baseline
- `src/backend/requirements.test.txt`, `src/backend/pytest.ini`
- new plugin under `src/backend/tests/` or `scripts/` (route it in `scripts/ci_policy.py`)
- `scripts/ci_policy.py`, a new `scripts/test_*` for the plugin (add it to `SCRIPT_TESTS` and both workflows' tooling job)
- `docs/plans/tasks/T13960-testmon-prototype.patch.gz` - reverted prototype to start from

### Related Tasks
- Follows: T13960 (not adopted; evidence there)
- Blocks: T13962

### Technical Notes
- testmon's `<module>` block already fingerprints a file's skeleton for any test that ran
  a line of that file; the remaining gap is tests that ran no line of it.
- Accepted residual risk even after this: code run once per process (session fixtures,
  caches shared across modules) and order-dependent tests. Master CI's full run stays
  the backstop.

## Acceptance Criteria

- [ ] Master CI saves a non-empty baseline per green merge (WAL checkpointed)
- [ ] Coverage is not restarted mid-run (plugin asserts the batch-size patch took effect)
- [ ] Import-time executed lines and `always_run.json` are saved with the baseline
- [ ] Master run cost (time, memory, cache size) measured and recorded here
