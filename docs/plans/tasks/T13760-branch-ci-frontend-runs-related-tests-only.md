# T13760: Branch CI frontend job runs only the tests related to the change, not the full suite

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Tier:** M (CI tooling + instruction docs; no app code)
**Created:** 2026-10-27
**Updated:** 2026-10-27
**Milestone:** CI & Instruction Tooling, see PLAN.md

## Problem

The Branch CI `frontend` job runs the whole Vitest suite on every branch (`npx vitest run --retry=2`, about 5,870 tests in 642 files, about 4.5 minutes), even when a PR touches two components. User decision 2026-10-27: branch CI should not run the full suite. It should run the tests that exercise the changed code.

## Decision (user, 2026-10-27)

- Branch CI `frontend` job: **selected tests only**, chosen by Vitest's static import graph. No shadow period; selection is the verdict from the first merge of this task.
- Master CI keeps the full Vitest run after every merge. It blocks no one, and it is the backstop for anything the import graph cannot see. If you want master narrowed too, say so before this lands.
- Scope is the frontend job only. Landing has no unit tests (its job is the Astro build plus `scripts/test_landing_gate.py`, about 25s). Backend selection is out of scope: most backend tests import `app.main` through `TestClient`, so an import graph would select nearly everything. Revisit with coverage-based selection (`pytest-testmon`) as a separate task if wanted.

## Solution

A new script, `scripts/select_frontend_tests.py`, decides between `full` and a file list. The `frontend` job then runs only that list.

### Selection rules (in this order; the first that applies wins)

1. **Full run** if any changed path is a test-infrastructure or config file: `src/frontend/package.json`, `src/frontend/package-lock.json`, `src/frontend/vite.config.js`, `src/frontend/vitest.onUnhandledError.js`, `src/frontend/src/version.stub.json`, anything under `src/frontend/test/` or `src/frontend/src/test-utils/` (check the real helper dirs when implementing), `src/frontend/eslint-rules/`, `.github/workflows/branch-ci.yml`, `.github/workflows/master-ci.yml`, or `scripts/select_frontend_tests.py` itself.
2. **Full run** if any changed path routes to the `frontend` job in `scripts/ci_policy.py` but lives outside `src/frontend/src/`. Example: `src/backend/app/quest_config.py`, which `questDefinitions.test.jsx` reads as text. These cross-tree consumers are invisible to the import graph. Reuse `ci_policy.py`'s routing (import it); do not duplicate its table.
3. **Otherwise, select:**
   - Every test file that imports a changed file, directly or transitively: `npx vitest related <changed src files> --run --passWithNoTests` (Vitest 4.0.13 is installed; confirm the flag set against it).
   - Plus every changed or added test file (`*.test.js`, `*.test.jsx`).
   - Plus every **source-scanning guard test**: any test file that reads the source tree as text (`readFileSync`, `readdirSync`, `globSync`, `import.meta.glob`, `fs.` calls on `src/` paths). Today that is `guidePulse.guard.test.js`, `resolveGuide.states.test.js`, `questDefinitions.test.jsx`, `shippedCopyHygiene.test.js`, `OverlayContainer.spotlightGate.test.js` and `veoHighlights/manifests.test.js`. **Detect them by grep at run time, not by a hand list,** so a new guard test is picked up automatically.
4. **Run nothing** (job passes with an explicit "no frontend tests selected" line) only when every changed frontend path is a non-code file that no test imports or scans, e.g. a `.md` under `src/frontend/`. An empty selection for a change that includes `.js`/`.jsx`/`.json` source is a bug: fail loudly instead.

The diff is `git diff --name-only $BASE_SHA...$HEAD_SHA`, using the base the `changes` job already records (`needs.changes.outputs.base`), not a fresh `origin/master`.

### CI wiring (`.github/workflows/branch-ci.yml`, `frontend` job)

- Replace the `Unit tests (vitest, retry absorbs known flakes)` step with:
  1. `python scripts/select_frontend_tests.py --base "$BASE_SHA" --head "$HEAD_SHA" --output vitest-selection.json`
  2. Run `npx vitest run --retry=2` either over the whole suite (`mode: full`) or over the listed files (`mode: selected`).
- Print the mode, the reason (which rule fired) and the selected count in the job log, and upload `vitest-selection.json` as an artifact so a reviewer can see what ran.
- ESLint, the viewport gate and the media-api-base gate stay as they are (they already scan `src` and are fast).
- `master-ci.yml`: unchanged.

## Context

### Relevant Files
- `scripts/select_frontend_tests.py` (new): selection logic and CLI.
- `scripts/test_select_frontend_tests.py` (new): unit tests for the rules, run by the `tooling` or `harness` job. Check which job `ci_policy.py` routes `scripts/` to and add a routing rule for the new files (an unrouted path fails `changes` with `UnclassifiedPath`).
- `.github/workflows/branch-ci.yml`: the `frontend` job step above.
- `scripts/ci_policy.py`: imported for routing; add rules for the two new scripts.
- `CLAUDE.md` § Test Scope Policy: replace "Branch CI is the mandatory full-sweep verdict" and "frontend/backend changes run their complete affected-layer suites" with the new frontend rule; master stays the full sweep.
- `.claude/skills/run-tests/SKILL.md`: same wording change.
- `.claude/knowledge/` docs that describe Branch CI scope (grep for "full suite", "full-sweep", "affected-layer"): update in the same PR (CLAUDE.md refactoring rule 5).

### Related Tasks
- T13710 (consumer-based CI routing): this task reuses its routing table.
- T13750 (require `ci-ready` via branch protection): independent, but both change what "green Branch CI" means.

### Technical Notes
- `vitest related` follows static `import`/`require` and Vite-resolved aliases. It does not see `vi.mock` factories that inline a module, dynamic `import()` built from a variable, or text reads of files; rule 3's guard-test sweep and rules 1-2 cover the known cases. Master CI catches the rest one merge later.
- Windows path separators: the script runs on Ubuntu in CI, but must also work locally on Windows for the acceptance check. Normalise to forward slashes.
- Evidence of the gap this closes: PR #654 shows both sides. Its full run caught 2 `OverlayContainer.test.jsx` failures that a hand-curated local set missed. `vitest related src/frontend/src/modes/overlay/hooks/useGuidedAthletePick.js` must select that file (acceptance case 2).

## Implementation

### Steps
1. [ ] Write `scripts/test_select_frontend_tests.py` first, covering every case under Acceptance Criteria; run it and see it fail (no script yet, so the failure must be an assertion on the CLI's output, not an import error).
2. [ ] Implement `scripts/select_frontend_tests.py`.
3. [ ] Wire `branch-ci.yml`; add `ci_policy.py` routing for the new files.
4. [ ] Update CLAUDE.md, the run-tests skill and the knowledge docs.
5. [ ] Open the PR and check in its CI log that the `frontend` job printed `mode: selected` and ran only the listed files.

## Acceptance Criteria

The script's output on each of these real diffs (run against the stated commits) is recorded in the PR:

- [ ] 1. A change to one leaf component selects that component's tests and the guard tests, and not the whole suite (e.g. T13620 follow-up, `c16138bfe` vs `efb16535e`: selects `SharedCollectionView*.test.jsx`, `PublishedReelsPanel*.test.jsx`, the guard tests; count reported).
- [ ] 2. A hook change selects every transitive consumer's tests: `useGuidedAthletePick.js` selects `OverlayContainer.test.jsx` (the file PR #654 broke).
- [ ] 3. A `vite.config.js` or `package.json` change gives `mode: full` with that rule named.
- [ ] 4. A change to `src/backend/app/quest_config.py` gives `mode: full` (cross-tree consumer).
- [ ] 5. A newly added `*.test.jsx` with no other change selects that file (plus the guard tests).
- [ ] 6. A new test file that calls `readFileSync` on `src/` is treated as a guard test without editing the script.
- [ ] 7. A `.md`-only change under `src/frontend/` selects nothing and the job passes with the "no frontend tests selected" line; a `.jsx` change that somehow selects nothing fails the job.
- [ ] 8. On this task's own PR, Branch CI `frontend` ran in `mode: full` (it changes `branch-ci.yml`, rule 1). On the next frontend-only PR after merge, it runs in `mode: selected` and is measurably faster; record both timings.
- [ ] 9. CLAUDE.md, the run-tests skill and the knowledge docs no longer say Branch CI runs the full frontend suite; `scripts/check_doc_drift.py` passes.
