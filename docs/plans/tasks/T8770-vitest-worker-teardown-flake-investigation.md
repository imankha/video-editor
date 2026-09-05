# T8770: Investigate + fix the recurring vitest-worker RPC-teardown CI flake

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-04

## Problem

`docs/testing/known-failures.md` row 30 documents a Vitest worker-pool RPC teardown race
(`Error: [vitest-worker]: Closing rpc while "fetch" was pending`) that fires as an
"Unhandled Rejection" AFTER the real test run has already finished and every test file has
genuinely passed — it fails the CI job anyway because the process exits non-zero.

This recurred **7 times in a single session on 2026-09-04** (T8390 x2, master, T8700,
T8690, T8555 x2), always on a real 100%-passing run (272-278/272-278 test files), rising
in frequency and severity (up to 8 unhandled rejections in one run) as the session's test
suite grew. This is no longer an occasional nuisance — it's costing real time every push
(re-run, re-diagnose, re-attribute) and risks becoming background noise that masks a
genuine future failure.

A fix was investigated once already (2026-09-04, same session, on an unrelated Master CI
run) — Vitest's `test.dangerouslyIgnoreUnhandledErrors` config flag — but reverted for
lack of time to verify it doesn't also swallow genuine in-test failures, not because the
approach was wrong.

## Solution (needs real investigation — not scoped in depth here)

1. Properly verify `dangerouslyIgnoreUnhandledErrors`'s exact semantics (read Vitest's
   source/changelog for the version pinned in this repo, not just guess) — specifically:
   does it suppress ONLY unhandled rejections/errors caught OUTSIDE test execution (the
   failure mode here), or could it also swallow a genuine assertion failure that happens
   to surface as an unhandled rejection from inside a test? Write a synthetic local
   repro (a deliberately-failing test alongside a synthetic post-run unhandled rejection)
   and confirm the flag distinguishes them correctly before trusting it in CI.
2. If that's confirmed safe, apply it in `vite.config.js` (or wherever the project's
   Vitest config lives) and remove/retire known-failures.md row 30 once a few real CI runs
   confirm it's gone.
3. If NOT safe, alternatives to evaluate: a `poolOptions`/pool-strategy change (the flake
   is worker-pool-specific), or a Vitest version bump if this is a fixed-upstream issue in
   a newer release.
4. Either way, confirm the fix doesn't mask a REAL post-test-run failure class — this
   flake's signature (fires after "N passed (N)") is specific enough that a narrow
   suppression should be safe, but prove it, don't assume it.

## Context

### Relevant Files
- `docs/testing/known-failures.md` row 30 — full occurrence history, all 7 same-session
  instances logged with run IDs and pass counts
- Vitest config (`vite.config.js` or equivalent) — where the fix would land
- `.github/workflows/branch-ci.yml` / `master-ci.yml` — the `--retry=2` this flake defeats
  (documented in known-failures.md as unable to absorb this class: "no FAILING TEST to
  retry, only a process-level exit code from an orphaned post-run rejection")

## Acceptance Criteria

- [ ] Root cause or reliable mitigation confirmed (not guessed) via a synthetic local repro
- [ ] Fix applied and verified against several real CI runs with zero regressions (a
      deliberately-failing test in the same run must still fail CI)
- [ ] known-failures.md row 30 retired (or narrowed) once confirmed fixed
