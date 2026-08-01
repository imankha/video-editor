# Run Tests Skill

Run tests for the video-editor project at the RIGHT scope. Default is **targeted**
(tests that exercise changed code); the full sweep is CI's job, not the worker's.

## Scope policy (the rule behind everything below)

- **Pre-handoff / iteration (default):** run only tests that exercise the changed
  code — tests written for the task, tests that import the changed modules, and the
  e2e spec(s) covering the changed flow. Never run full suites to "confirm no
  regressions" locally.
- **Full sweep:** Branch CI runs the complete vitest + pytest suites on every push
  (`branch-ci.yml`, ~5 min, zero tokens), and Master CI re-runs them on the merged
  state of master (`master-ci.yml`). The mandatory `gh run watch` CI verdict after
  push IS the no-regressions proof.
- **Fix loop:** when a test fails, fix it, then re-run (a) the failing test and
  (b) tests that exercise the files the FIX touched. Tests that already passed and
  whose subject code did not change are NOT re-run — the next push's Branch CI
  re-proves them for free.
- **Explicit full run:** only when the user asks for it ("/run-tests full", "run
  everything") or when no CI is reachable.

## Usage
Invoke with `/run-tests` (targeted, default) or `/run-tests full`. Also when the
user asks to "run tests" / "check if tests pass" — targeted unless they say full.

## 1. Targeted mode (default)

### Frontend unit (Vitest)
`vitest related` resolves which tests import the given SOURCE files — the exact
"tests exercised by the change" set:
```bash
cd src/frontend
CHANGED=$(git diff --name-only master...HEAD -- 'src/frontend/src/**/*.js' 'src/frontend/src/**/*.jsx' | sed 's|^src/frontend/||' | grep -v '\.test\.')
npx vitest related --run $CHANGED
# Plus any test files the task added/changed, by path:
npx vitest run src/components/Foo.test.jsx
```

### Backend (pytest)
No `related` equivalent — map changed modules to their test files by convention
(`app/routers/clips.py` -> `tests/test_clips*.py`) and by import:
```bash
cd src/backend
grep -l "changed_module" tests/test_*.py   # tests importing the changed code
.venv/Scripts/python.exe -m pytest tests/test_clips.py tests/test_exports.py -v --tb=short --capture=sys
```
**Warning:** backend tests TRUNCATE the real dev Postgres — fine in a task
container, warn the user first in the shared checkout.

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
3. Re-run tests exercising the fix's files (`vitest related` on them / the pytest
   module map). NOT the full suite.
4. Compare any pre-existing failure against `docs/testing/known-failures.md`
   instead of re-proving it.
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
- Targeted mode: every test exercising the changed code passes; scope note says
  which suites were intentionally NOT run (they're CI's job).
- Full mode: suites green modulo `docs/testing/known-failures.md`.
