# T5030: ESLint warning backlog regrew past the CI gate (1038 > 1019) — burn it back down

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

The Branch CI frontend job fails its regression gate on every current branch:

```
ESLint regression gate (whole src must not regrow the backlog)
npx eslint src --max-warnings 1019
✖ 1038 problems (0 errors, 1038 warnings)
Process completed with exit code 1.
```

T4790 froze the backlog at **0 errors / 1019 warnings** on 2026-07-10 with an
explicit ratchet rule in the workflow comment: "Ratchet these numbers DOWN as
the warning backlog is cleared; never up." The work merged since (T4850,
T4880, T4890, T4900, T3950, unfurl audit, ...) added a net **+19 warnings**,
so the gate has failed ever since — and because the backend job was ALSO dead
(T5020), the whole Branch CI being red read as background noise and nobody
attributed the new failures.

Verified locally on master @ `fce6a643`: `npx eslint src` → 0 errors,
1038 warnings.

## Solution

Burn AT LEAST 19 warnings to get back under 1019 — do NOT raise the baseline
(the workflow comment forbids it). Preferred: burn comfortably below (e.g. to
~1000) and ratchet the gate down to the new count so the next regression
fails loudly at the offending branch instead of accumulating.

The current crop is dominated by trivial classes:
- `no-unused-vars` on imports/args in new components and tests (fix: delete or
  `_`-prefix per the existing convention)
- `Unused eslint-disable directive` — **12 are auto-fixable**:
  `npx eslint src --fix` removes them safely
- `react-hooks/exhaustive-deps` on new hooks — do NOT blanket-fix these by
  adding deps (that can change behavior / create the reactive-persistence
  pattern CLAUDE.md bans). Only touch ones that are provably inert, otherwise
  leave them in the backlog count.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/branch-ci.yml` — the gate line (`--max-warnings 1019`);
  ratchet DOWN to the post-burn count
- `src/frontend/src/**` — warning sites; get the authoritative list with
  `npx eslint src --format stylish` (or `--format json` for counting by rule)

### Related Tasks
- T4790 (lint backlog freeze) — established the gate + the ratchet rule
- T5020 / T5040 — the sibling CI-signal tasks from the same audit

### Technical Notes
- Attribution shortcut: `git diff ef723e0d..master --name-only -- src/frontend/src`
  lists the files the staged work touched — the +19 live almost entirely
  there; fixing warnings in JUST those files avoids drive-by churn in
  untouched code (smaller diff, easier review).
- `npx vitest run` must stay green after the burn (unused-import deletions in
  test files can break mocks that rely on import side effects — rare, but
  check).
- Do not fix warnings by adding `eslint-disable` comments — that defeats the
  gate.

## Implementation

### Steps
1. [ ] `npx eslint src --fix` (removes the 12 unused-disable directives);
       verify nothing else changed behaviorally (`git diff`).
2. [ ] Fix `no-unused-vars` in the files from the staged-diff list until the
       count is comfortably under 1019 (target ~1000).
3. [ ] `npx vitest run` green; `npx eslint src --max-warnings <new>` green.
4. [ ] Ratchet the workflow gate down to the new count (same commit).
5. [ ] Push branch; confirm the frontend CI job passes the gate.

### Progress Log

**2026-07-13**: Implemented. `npx eslint src --fix` removed 12 unused-disable directives
(comment-only changes, verified via git diff: only eslint-disable lines removed). Then
burned 28 additional warnings by: (a) removing `import React from 'react'` / `React,`
from 13 staged component files (safe: React 17+ JSX transform, React never referenced
directly; verified via grep refs=0 per file); (b) Toast.jsx also dropped unused `useEffect`
(only on import line, never called); (c) DownloadsPanel.jsx: 3 unused hook destructuring
vars + 2 dead local consts removed; (d) AnnotateContainer.jsx: 3 unused hook vars removed,
1 dead rename alias removed, dead Promise.all().then() callback removed, 4 unused function
args prefixed with `_`. Result: 1038 -> 998 warnings (0 errors). Gate ratcheted to 998.
vitest: 979 passed (1 known flake -- profileStore switchProfile timeout -- passes in
isolation, fails intermittently under full-suite load per known-failures.md).
Committed as chore(T5030) on feature/T5020-T5030-branch-ci-green. CI push required to
confirm frontend gate passes -- deferred to supervisor.

**2026-07-13**: Found while auditing the red Branch CI after the derisk wave;
counted 1038 locally on master `fce6a643`.

## Acceptance Criteria

- [ ] `npx eslint src` reports 0 errors and <= the new gate value
- [ ] Gate in branch-ci.yml ratcheted DOWN (never up) to the new count
- [ ] `npx vitest run` green after the burn
- [ ] Frontend Branch CI job green on the task branch
