# T5020: Backend CI has NEVER run — httpx pin conflict makes pip install ResolutionImpossible

**Status:** DONE
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

The Branch CI backend job fails at the INSTALL step on every run it has ever
had — zero backend tests have ever executed in CI:

```
Run pip install -r requirements.prod.txt -r requirements.test.txt "httpx<0.28" ruff
ERROR: Cannot install httpx<0.28 and httpx==0.28.1 because these package
versions have conflicting dependencies.
ResolutionImpossible
```

Timeline (proven from git):
- `httpx==0.28.1` pinned in `src/backend/requirements.prod.txt` (and
  `requirements.txt`) since **2026-02-13** (`05c2fe42`).
- The CI step adding `"httpx<0.28"` (the starlette TestClient `app=` kwarg
  workaround from known-failures.md) landed **2026-07-04** (`9ef8fa65`) — the
  day Branch CI was created. The two have conflicted from day one.

Consequence: the backend half of Branch CI provides no signal at all. The
2026-07-12 derisk sweep found `test_shares` red on master for days and CI
never surfaced it — it couldn't; it never got past pip.

Note: the same run's frontend job fails separately (eslint gate — see T5030),
so the fully-green Branch CI has never existed.

## Solution

Decide the httpx story ONCE (it currently lives in 3 places: requirements
pins, the CI install step, the container bootstrap):

- **(A) Root cause — make the test stack compatible with httpx 0.28**:
  upgrade `starlette`/`fastapi` to versions whose `TestClient` uses
  `transport=` instead of the removed `app=` kwarg. Then DELETE the
  `"httpx<0.28"` from the CI step, the container bootstrap, and the
  known-failures.md row. Prod already runs httpx 0.28.1, so this aligns test
  and prod on the same version — strictly better.
- **(B) Quick unblock — downgrade as a second command**: keep requirements
  as-is; change the CI step to `pip install -r ... && pip install
  "httpx<0.28"` (two commands — a sequential downgrade resolves; a single
  resolve conflicts). Tests then run on a DIFFERENT httpx than prod, which is
  exactly the drift that produced this mess.

**Decision rule**: try (A) first — check the fastapi/starlette changelog for
the pinned versions in requirements; if the TestClient `transport=` change is
available within a patch/minor upgrade that the backend suite passes on,
do (A). Only fall back to (B) if (A) requires a major-version migration, and
then file the follow-up for (A).

## Context

### Relevant Files (REQUIRED)
- `src/backend/requirements.prod.txt` (httpx==0.28.1, fastapi/starlette pins)
- `src/backend/requirements.txt`, `src/backend/requirements.test.txt`
- `.github/workflows/branch-ci.yml` — backend job install step
- `.devcontainer/task-bootstrap.sh` — the container-side pin (same story)
- `docs/testing/known-failures.md` — the httpx row (delete when (A) lands)

### Related Tasks
- T5000 (container test-env hygiene) — its httpx bullet is SUPERSEDED by this
  task; whichever lands second just deletes the leftover pin site.
- T5030 (eslint gate regrown) — the other half of the never-green Branch CI.
- T5040 (CI signal must be consumed) — the process fix so 9 days of red CI
  can't go unnoticed again.

### Technical Notes
- After the install is fixed, the backend job runs its test selection FOR THE
  FIRST TIME. Its true state is unknown: expect the known-failures rows
  (ffprobe/ffmpeg availability, deselected class) plus possibly
  `test_t4050_missing_source_reexport` (T4990) and torch-dependent collection
  (T5000). Budget a triage loop: every failure either gets fixed here (if
  this task caused it), attributed to an existing task, or added to
  known-failures.md with evidence — per that doc's rules.
- The CI backend job needs a DATABASE_URL; check what the workflow provisions
  (services: postgres?) — if it never ran, this may also be unproven.

## Implementation

### Steps
1. [ ] Changelog check: smallest fastapi/starlette bump where TestClient uses
       httpx>=0.28 (`transport=`). Decide (A) vs (B) per the rule.
2. [ ] Apply the change; run the targeted backend suite locally in a container
       against a throwaway Postgres (NEVER the host dev DB — tests truncate).
3. [ ] Push a probe branch; confirm the backend job gets past pip and RUNS
       tests. Triage every failure per the Technical Note.
4. [ ] Sync the container bootstrap + known-failures.md to the decision.
5. [ ] Acceptance: a Branch CI run where the backend job executes pytest and
       its result is green or 100%-attributed.

### Progress Log

**2026-07-13**: Found while auditing why both derisk-wave branches showed red
CI. Full evidence in the CI run log for run 29264734885.

**2026-07-13**: Implemented Option A (root cause fix, not the CI-only downgrade).
Verified from starlette source that 0.37.2 is the first release to drop `app=self.app`
from TestClient.__init__ (0.37.1 still passes it). fastapi 0.110.1 is the first release
admitting starlette>=0.37.2. pydantic 2.5.0 / typing_extensions 4.15.0 satisfy 0.110.1
constraints -- no cascade. pip install resolves clean (exit 0, httpx stays 0.28.1).
`from app.main import app` OK. Targeted backend suites: 159 passed (incl. the formerly-
broken test_collection_shares.py) + broader set 13 passed on throwaway PG. Zero new
failures. Committed as fix(T5020) on feature/T5020-T5030-branch-ci-green. CI run required
to confirm backend job executes pytest for the first time -- deferred to supervisor.

## Acceptance Criteria

- [ ] Backend CI job passes pip install and executes pytest
- [ ] httpx version story exists in exactly ONE place (requirements), with CI
      and container bootstrap consistent with it
- [ ] Every backend-job test failure fixed, attributed, or added to
      known-failures.md with evidence
- [ ] known-failures.md httpx row updated/removed to match reality
