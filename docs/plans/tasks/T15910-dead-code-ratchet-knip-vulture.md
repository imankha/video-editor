# T15910: Dead-code ratchet: knip for the frontend, vulture for the backend, CI fails only on new findings

## In plain words

Dead code misleads the AI agents that work in this repo: they read unused files and copy from them. A first scan found 14 frontend files nothing imports and 11 backend findings. Set up two scanners, knip for the frontend and vulture for the backend, with a committed list of known findings, so CI fails only when new dead code appears and the list only shrinks. Then delete what no planned task claims.


**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap, Chores (see PLAN.md)

## How we got here

Owner 2026-11-09: "AI will perform better with less false code." Agents read the tree to find the
code path; every unimported module, unreachable branch and unused helper is a false lead they can
follow or copy. Today ruff's pyflakes rules catch unused imports and variables on backend changes,
ESLint catches unused variables on the frontend, and nothing catches an unused module, export,
function or class. Vulture is installed in `src/backend/.venv` and never run.

A first read on 2026-11-09:

| Scan | Result |
|---|---|
| Vulture, `app/`, 80% confidence | 11 findings: vendored RIFE imports, two unreachable-after-`try` blocks (`routers/export/overlay.py:1301`, `services/processor_local.py:310`), an unused `skip_quest_ids` in `routers/quests.py` |
| Vulture, 60% confidence | 595 lines, mostly false positives (route handlers, pydantic models, model `forward` methods) |
| Import-graph heuristic over 593 frontend modules | 14 modules nothing imports from `src/`, `e2e/`, `scripts/` or the landing site: `components/CropControls.jsx`, `DebugInfo.jsx`, `ProjectHeader.jsx`, `QuestIcon.jsx`, `Timeline.jsx`, `collections/UnlockProgress.jsx`, `hooks/useCurrentVideoState.js`, `useExportManager.js`, `useRawClips.js`, `useStorageUrl.js`, `useTimeline.js`, `utils/gameNameLookup.js`, `uniqueName.js`, `veoHighlights/durationWorker.js` |

Those 14 line up with the plan: `Timeline.jsx` is the dead stack T4440 names, `QuestIcon.jsx` belongs
to the quest deletion (T11180), and `uniqueName.js` is the helper T11300 says to resurrect, so the
tool must respect planned reuse, not delete on sight.

## The problem

Dead code is found by hand, one task at a time, and a zero-callers claim is only as good as the grep
that backs it (CLAUDE.md Refactoring Rules, rule 7: `src/`, `e2e/` and `scripts/` all count, because
Branch CI never runs Playwright specs or shell scripts). There is no floor that stops new dead code
landing.

## What we will do

The same ratchet pattern `scripts/check_doc_drift.py` uses: a committed baseline, CI fails only on
findings not in the baseline, the baseline only shrinks.

1. **Frontend: knip.** `src/frontend/knip.json` with entry points `src/main.jsx`, the service worker
   and PWA registration, every `e2e/**/*.spec.*`, `scripts/**` that imports from `src/`, and the
   landing site's `@editor` alias consumers. Report unused files, unused exports and unused
   dependencies. Run as `npm run deadcode` and in the CI `tooling` job.
2. **Backend: vulture.** `src/backend/vulture_whitelist.py` generated once with
   `vulture app --make-whitelist` at 80% confidence, then hand-pruned so FastAPI handlers, pydantic
   fields and torch `forward` methods are whitelisted by pattern rather than by name; `--min-confidence
   80`; excluded: `.venv`, `tests`, vendored `ai_upscaler/rife`. Run as a `.venv` script and in the
   `tooling` job.
3. **Baseline and ratchet.** `scripts/check_dead_code.py` runs both, compares against
   `scripts/dead_code_baseline.json`, fails on any finding not in the baseline, and fails if the
   baseline names a finding that no longer exists (so the baseline only shrinks). `scripts/ci_policy.py`
   routes frontend, backend and tooling paths to it (a rule naming the job, never a fan-out).
4. **First sweep, separate PRs.** Delete what the first run finds that no task claims: the 11 vulture
   findings and the orphans not reserved by T4440, T11180 or T11300. Each deletion follows rule 7
   (grep evidence over `src/`, `e2e/`, `scripts/`) and lands as a mechanical commit. Planned
   deletions stay with their tasks; this task only removes unclaimed dead code.
5. **Knowledge.** One paragraph in `.claude/references/coding-standards.md` (Refactoring Rules): the
   zero-callers proof is the dead-code check passing, plus the grep.

## How we will know it worked

- [ ] `npm run deadcode` in `src/frontend` and the vulture script in `src/backend` run from a clean checkout and list their findings in under 60 s each.
- [ ] `scripts/check_dead_code.py` passes on master with the committed baseline, fails on a branch that adds an unimported module or an unused backend function (two tests in `scripts/test_check_dead_code.py`), and fails when the baseline names a finding that is gone.
- [ ] The `tooling` job runs it; `scripts/test_ci_policy.py` routes `src/frontend/**`, `src/backend/**` and the check itself to that job.
- [ ] The first sweep removed every unclaimed finding from the 2026-11-09 read; the baseline holds only findings owned by a named task (T4440, T11180, T11185, T11300), each annotated with that id.
- [ ] Rule 7 in CLAUDE.md names the check as the proof of zero callers.

## For the implementer

### Related Tasks
T4440 (dead keyframe stack), T4420 (unwired Modal copies), T11180 / T11185 (quest deletion),
T11250 / T11260 (multi-clip removal), T11300 (reuses `uniqueName.js`), T13720 (doc-drift ratchet
pattern), T13750 (branch protection), T11905 (a helper that silently skipped: dead-by-regex).

### Relevant Files (REQUIRED)
- `scripts/check_doc_drift.py`, `scripts/test_check_doc_drift.py` (the ratchet pattern to mirror)
- `scripts/ci_policy.py`, `scripts/test_ci_policy.py` (job routing)
- `src/frontend/package.json` (new `deadcode` script, knip devDependency)
- `src/backend/ruff.toml` (existing F rules stay)
- `src/backend/.venv/Scripts/vulture.exe` (installed, unused)
- `.github/workflows/` (the `tooling` job)
- `CLAUDE.md` (Refactoring Rules, rule 7)
