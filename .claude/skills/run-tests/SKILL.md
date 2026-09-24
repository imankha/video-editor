---
name: run-tests
description: Run the curated feature, regression, consumer, and changed-flow tests for this project and report actual evidence. Use when asked to run or verify tests; full suites require an explicit request.
user-invocable: true
---

# Run Tests Skill

Run tests for the video-editor project at the RIGHT scope. Default is **targeted**
(tests that exercise changed code); the full sweep is CI's job, not the worker's.

## Scope policy (the rule behind everything below)

- **Pre-handoff / iteration (default):** run only tests that exercise the changed
  code — tests written for the task, tests that import the changed modules, and the
  e2e spec(s) covering the changed flow. Never run full suites to "confirm no
  regressions" locally.
- **Full sweep:** Branch CI runs complete unit suites for affected layers on matching branch pushes
  (`branch-ci.yml`; runtime varies), and Master CI re-runs them on the merged
  state of master (`master-ci.yml`). The mandatory CI verdict after push is independent unit-suite evidence, not proof that no regression exists or that E2E ran.
- **Fix loop:** when a test fails, fix it, then re-run (a) the failing test and
  (b) tests that exercise the files the FIX touched. Tests that already passed and
  whose subject code did not change are NOT re-run — the next push's Branch CI
  rechecks them on the next CI run.
- **Explicit full run:** only when the user asks for it ("/run-tests full", "run
  everything"). If CI is unreachable, report the blocker; a local full run does not replace mandatory CI for automatic landing.

## Usage
Invoke with `/run-tests` (targeted, default) or `/run-tests full`. Also when the
user asks to "run tests" / "check if tests pass" — targeted unless they say full.

## 1. Targeted mode (default)

### Frontend unit (Vitest)
Use imports and `vitest related` as candidate discovery, not a complete coverage claim. Curate and name the feature/regression/consumer set before executing it:
```bash
cd src/frontend
CHANGED=$(git diff --name-only master...HEAD -- 'src/frontend/src/**/*.js' 'src/frontend/src/**/*.jsx' | sed 's|^src/frontend/||' | grep -v '\.test\.')
# Inspect the changed-source imports and test references, then run named tests:
npx vitest run src/components/Foo.test.jsx <other-curated-test-files>
```

### Backend (pytest)
Find candidates by module, imports, and behavior, then include tests of direct consumers. Filename matching alone misses indirect backend regressions:
```bash
cd src/backend
grep -l "changed_module" tests/test_*.py   # tests importing the changed code
.venv/Scripts/python.exe -m pytest tests/test_clips.py tests/test_exports.py -v --tb=short --capture=sys
```
**Database precondition:** backend fixtures can truncate data. Confirm the resolved target is an authorized disposable test database; container execution alone does not isolate a shared Postgres server. Follow CLAUDE.md Data Safety Rules if deletion scope is not already authorized.

### E2E (Playwright) — targeted only, never full
Full e2e is hours-class and runs nowhere routinely. Run the spec(s) for the
changed flow, plus the screen-usability audit grep'd to changed screens:
```bash
cd src/frontend
npm run test:e2e -- e2e/T4850-move-reels.spec.js          # the changed flow
npx playwright test screen-usability.spec.js --grep "Gallery"  # changed screen only
```
Servers must be running (ports 8000/5173) — or use `bash scripts/dev-verify.sh <spec>`.

### Fix loop (all layers)
1. Failing test -> diagnose -> fix.
2. Re-run the failing test by file:line / `-k` name.
3. Re-run the curated tests exercising the fix and its affected consumers, not the full suite.
4. Use `docs/testing/known-failures.md` as a lead; substantiate attribution with current baseline evidence. Otherwise report it as unverified. A known failing run is still a failing run.
5. Push; the Branch CI verdict is the full-suite confirmation.

## 2. Full mode (explicit request only)

```bash
# Frontend unit — ~1,400 tests / ~140 files, ~1-2 min
cd src/frontend && npm test

# Backend — ~2,400 tests / ~200 files, ~4-8 min
cd src/backend && .venv/Scripts/python.exe run_tests.py
# (equivalent: .venv/Scripts/python.exe -m pytest tests/test_*.py -v --tb=short --capture=sys)
```
Redirect output to a log and `reduce_log` it (CLAUDE.md § Log handling). There is
no "full e2e" step even here — ~300 tests / 90+ specs with a 5-min per-test
timeout; scope e2e to named specs or defer to the staging pass.

## Key Details
- Frontend unit: Vitest 4 + jsdom; `vitest related` needs SOURCE paths, not test paths
- Backend venv: `src/backend/.venv`; pytest needs `--capture=sys` (closed-handle issue)
- Plain `pytest tests/` crashes — always glob `tests/test_*.py` (see project memory)
- E2E: ports 5173 + 8000; test data at `../../formal annotations/12.6.carlsbad`
- Server check: `curl -s http://localhost:8000/api/health` / `curl -s http://localhost:5173`

## Success Criteria
- Targeted mode: the named relevant set passes; scope note says
  which suites were intentionally NOT run (they're CI's job).
- Full mode: report actual pass/fail/skip counts and substantiated baseline failures separately; no "green modulo" verdict.
