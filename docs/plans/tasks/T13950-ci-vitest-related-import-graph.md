# T13950: Branch CI frontend job runs only import-graph-related vitest tests

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Branch CI's frontend job runs the full vitest suite (`npx vitest run --retry=2`,
`.github/workflows/branch-ci.yml` frontend job) whenever any frontend-routed path changes.
The user wants Branch CI to run only the tests reachable through the import tree of the
changed files. Today selection is layer-scoped (T6405): which job runs is chosen per path, but
inside the job every test runs.

## Solution

In Branch CI only, replace the full run with `npx vitest related --run --retry=2 <changed files>`,
which walks Vite's module graph from each changed source to the tests that import it
(directly or transitively). Master CI keeps the full `npx vitest run` as the post-merge sweep.

Fall back to the full suite (bias toward RUNNING) when the changed set includes anything the
module graph cannot see:
- `package.json`, `package-lock.json`, `vite.config.*`, `vitest.config.*`, setup files,
  `tsconfig`/`jsconfig`, `.env*`, tailwind/postcss config
- files read at runtime rather than imported (JSON fixtures loaded via `fs`, `?raw` assets,
  `import.meta.glob` targets): enumerate these and decide per case
- cross-tree inputs routed to `frontend` by `CROSS_TREE_READS` / `FRONTEND_TOOLS` in
  `scripts/ci_policy.py` (e.g. `src/backend/app/pricing.json`, `quest_config.py`), since the
  test that reads them is not an importer
- `.github/workflows/*` and the `EVERYTHING` set

Lint, build, and the static gates (viewport units, media-api-base) stay full; they are cheap
and are not tests.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/branch-ci.yml` - frontend job's vitest step; `changes` job outputs
- `scripts/ci_policy.py` - emit the changed frontend file list (and a "full" flag) as a job output
- `scripts/test_ci_policy.py` - pin the new output and fallback rules
- `.claude/skills/run-tests/SKILL.md`, `CLAUDE.md` (Test Scope Policy) - update the "complete
  affected-layer suites" wording
- memory note `feedback_changed_code_test_scope.md` records the 2026-08-03 rejection of
  per-file selection; this task supersedes it for the frontend only, because `vitest related`
  is import-graph based, not path-name based

### Related Tasks
- Sibling: T13960 (backend testmon), T13970 (ci_policy.py edits stop fanning out)

### Technical Notes
- Verify `vitest related` follows dynamic `import()` and re-exports through barrel files.
- Measure on 3 recent frontend PRs: tests selected vs full, wall time saved, and whether any
  test that failed in Master CI after merge would have been skipped.

## Acceptance Criteria

- [ ] A frontend-only change runs only related tests in Branch CI; the job log lists the selected set
- [ ] Any config, lockfile, or non-import-read change runs the full suite
- [ ] Master CI unchanged (full suite)
- [ ] `test_ci_policy.py` covers the selection output and every fallback trigger
- [ ] CLAUDE.md / run-tests skill describe the new scope
