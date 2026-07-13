# T5000: Container test-env hygiene + known-failures.md refresh

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

The 2026-07-12 derisk sweep ran the full backend suite in a fresh /dotask
container and hit four environment problems that cost real triage time and
will bite every future worker identically:

1. **httpx pin drift**: the container had httpx 0.28.1 → 6 test files fail
   collection with `Client.__init__() got an unexpected keyword argument
   'app'`. known-failures.md CLAIMS "container bootstrap pins httpx<0.28" —
   it does not (or the pin lost to dependency resolution). Manual
   `pip install 'httpx<0.28'` fixed it.
   **SUPERSEDED by T5020** (2026-07-13): the same conflict makes backend CI
   `ResolutionImpossible` at install — T5020 decides the httpx story once
   (requirements/starlette upgrade); this task then only verifies the
   container matches that decision.
2. **torch missing**: `tests/test_ai_upscaler.py` fails collection with
   `ModuleNotFoundError: No module named 'torch'` and — because it is a
   COLLECTION error — pytest aborts the ENTIRE run (`Interrupted: 1 error
   during collection`), not just that file.
3. **Windows bind-mount timing**: `test_session_init_recovery.py::...
   ::test_create_task_branch_propagates_context_and_does_not_block` fails
   when run from `/workspace` (Windows bind mount; sqlite executes ~19ms vs
   ~4ms) and passes 3/3 from container-local disk. A timing assert
   (`elapsed < 0.1`) cannot hold on the mount.
4. **known-failures.md is stale**: `test_t4050_missing_source_reexport` fails
   at the prod base and on master (see T4990) but has no row, so every
   full-suite run re-litigates it. The "Fixed in vite.config.js" row (perf
   spec collected by vitest) also needs its confirm-and-delete pass.

## Solution

Make the container's full backend suite runnable green-or-attributed out of
the box:

- Pin `httpx<0.28` where the container actually installs deps
  (`src/backend/requirements.test.txt` if it's the source of the drift, else
  `.devcontainer/task-bootstrap.sh`) — note the image tag is a content hash
  of the Dockerfile + requirements files, so a requirements change
  auto-rebuilds (task.sh `image_hash`).
- Guard `test_ai_upscaler.py` with a module-level
  `pytest.importorskip("torch")` so a torch-less environment SKIPS instead of
  aborting collection.
- For the timing test: either raise the threshold with a comment, or (better)
  mark it with a custom marker (e.g. `@pytest.mark.local_disk_timing`) and
  document that /workspace runs deselect it; do NOT delete the assert — it
  guards a real fire-and-forget contract.
- Update `docs/testing/known-failures.md`: add the t4050 row (with the
  first-failure line from the sweep) unless T4990 lands first; delete rows
  fixed by the above; keep the CI `--deselect` list in sync per the doc's own
  rule 3.

## Context

### Relevant Files (REQUIRED)
- `src/backend/requirements.test.txt` (or `.devcontainer/task-bootstrap.sh`) — httpx pin
- `src/backend/tests/test_ai_upscaler.py` — importorskip guard
- `src/backend/tests/test_session_init_recovery.py` — timing marker/threshold
- `docs/testing/known-failures.md` — rows + deselect sync
- `.github/workflows/branch-ci.yml` — deselect list if rows change

### Related Tasks
- T4990 — if it lands first, no t4050 row is needed
- Container sandbox reference: memory "Container Sandboxes" / scripts/task.sh

### Technical Notes
- Evidence commands from the sweep (all in a container, DATABASE_URL pointed
  at a throwaway Postgres — NEVER the host dev DB):
  - httpx: `python -c "import httpx; print(httpx.__version__)"` → 0.28.1
  - torch: full run → `Interrupted: 1 error during collection`
  - timing: 3/3 fail from /workspace, 3/3 pass from a `/tmp` worktree
- Also note for the doc: the conftest `pg_conn` fixture requires
  `schema_migrations` to already exist — on a FRESH throwaway Postgres, run
  `init_pg_schema()` once first or the first pg-backed tests error. Worth a
  line in known-failures.md's header or the fixture docstring.

## Implementation

### Steps
1. [ ] Find where the container's httpx actually comes from; add the pin;
       verify a fresh `task.sh up` container imports httpx<0.28.
2. [ ] `pytest.importorskip("torch")` in test_ai_upscaler.py; confirm a
       torch-less run completes with a skip, not an interrupt.
3. [ ] Timing-test marker or threshold + comment.
4. [ ] known-failures.md rows updated; CI deselect list synced.
5. [ ] Full suite in a fresh container: paste the tail (expected: green except
       documented known-failures rows).

### Progress Log

**2026-07-12**: All four issues hit and manually worked around during the
derisk sweep; full attribution in the sweep report.

**2026-07-13** (T5020 CI fix): Added `pytest.importorskip("torch")` at module level in
tests/test_ai_upscaler.py (before the `with patch('torch.cuda.is_available')` block);
confirmed 1 skipped / 0 errors when torch absent in this container.

**2026-07-13** (T5020 CI fix): Changed CI Pytest step from `pytest tests/` to
`pytest tests/test_*.py` (canonical selection matching run_tests.py); `tests/integration/`
excluded. The `pytest tests/` form triggers a capture-closing internal error
(ValueError: I/O operation on closed file) that the canonical glob avoids.

## Acceptance Criteria

- [ ] Fresh container full-suite run needs zero manual pip/env fixes
- [ ] torch-less run skips (not aborts)
- [ ] known-failures.md matches reality; CI deselects match the doc
