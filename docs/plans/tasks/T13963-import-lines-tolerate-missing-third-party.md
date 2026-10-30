# T13963: Master CI baseline tolerates modules whose third-party dependency CI lacks

**Status:** STAGING
**Impact:** 8
**Complexity:** 3
**Created:** 2026-10-30
**Updated:** 2026-10-30

## Problem

Master CI is red on master since T13961/T13962 landed (run 41075309424 on `c08943f01`, after the
Python pin fix in PR #680). The backend suite passes, then the step "Record import-time lines and
checkpoint the baseline" exits 1, so no testmon baseline is saved and the staging deploys that
follow Master CI do not run.

`scripts/testmon_import_lines.py` imports every module under `app/` (`pkgutil.walk_packages`)
and fails the whole run on ANY import error. CI does not install `torch`, so five modules fail:

```
app.ai_upscaler.frame_enhancer: ModuleNotFoundError: No module named 'torch'
app.ai_upscaler.frame_processor: ModuleNotFoundError: No module named 'torch'
app.ai_upscaler.model_manager: ModuleNotFoundError: No module named 'torch'
app.ai_upscaler.models.hat_arch: ModuleNotFoundError: No module named 'torch'
app.ai_upscaler.models.swinir_arch: ModuleNotFoundError: No module named 'torch'
```

T13962's outcome note flagged this as not exercised locally (no torch in the container).

## Solution

User decision 2026-10-30 (option 1 of 2; installing CPU torch in CI was rejected as a heavy
per-run download that leaves the failure mode open for the next optional dependency):

1. `scripts/testmon_import_lines.py`: a `ModuleNotFoundError` whose missing module is a
   THIRD-PARTY top-level package (`exc.name` not `app` / `app.*` and not a local module under
   `src/backend`) is recorded, not fatal. Every other error (SyntaxError, NameError, a missing
   `app.*` module, SystemExit, a collection failure) still fails the run and writes nothing.
   A package whose `__init__` fails this way is recorded the same way (its submodules are not
   walked). Print the recorded modules to the log either way.
2. Output carries the list. Change `import_lines.json` to
   `{"lines": {<relative path>: [lines]}, "unimportable": {<relative path>: "<missing package>"}}`
   (paths relative to `src/backend`, as today).
3. `scripts/ci_policy.py` `pytest_plan`: any changed (or deleted) path listed in
   `unimportable` forces the full suite (reason names the file and the missing package). An
   `import_lines.json` in the OLD flat shape (no `lines` key) also forces the full suite with a
   clear reason (bias toward RUNNING; no silent fallback reading it as the old shape).
4. Tests: `scripts/test_testmon_baseline.py` (third-party ModuleNotFoundError recorded; missing
   `app.*` module still fatal; other errors still fatal and write nothing) and
   `scripts/test_ci_testmon_selection.py` (change to an unimportable file -> full; old-shape
   file -> full; ordinary body change still selects).
5. Prove it on the real runner: Master CI on the merge must go green AND save the
   `testmon-<sha>` cache entry (`gh cache list`). This is the acceptance check that matters;
   local runs without torch reproduce the failure but not the full workflow.

Tier M. No workflow change expected (the cache paths stay the same three files plus
`.testmondata`); if one turns out to be needed, it is in scope.

## Context

### Relevant Files (REQUIRED)
- `scripts/testmon_import_lines.py` - tolerate third-party ModuleNotFoundError, new output shape
- `scripts/ci_policy.py` - `pytest_plan`: unimportable-path trigger, old-shape trigger
- `scripts/test_testmon_baseline.py`, `scripts/test_ci_testmon_selection.py`
- `.github/workflows/master-ci.yml` - read-only unless the step needs a change
- `docs/plans/tasks/T13961-master-ci-hardened-testmon-baseline.md`,
  `docs/plans/tasks/T13962-branch-ci-testmon-file-selection.md` - outcome notes to correct

### Related Tasks
- Fixes: T13961, T13962 (both STAGING). Prior fix: PR #680 pinned Python 3.11.17 (3.11.11 is not
  offered on Ubuntu 26.04).

## Acceptance Criteria

- [ ] A third-party `ModuleNotFoundError` during the import walk is recorded in `unimportable`, not fatal
- [ ] Any other import or collection error still fails the run and writes no file
- [ ] A Branch CI diff touching an unimportable module plans the full suite; an old-shape `import_lines.json` plans the full suite
- [ ] Master CI on master goes green and saves a `testmon-<sha>` cache entry
