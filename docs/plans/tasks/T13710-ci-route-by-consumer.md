# T13710: Route Branch CI by the job that consumes each path

**Status:** see PLAN.md · **Tier:** L (CI policy + workflows) · **Builds on:** T13700 (qa/ evidence routing)

## Problem

`scripts/ci_policy.py` sent every unrecognized path to frontend + backend + shrink. Replaying the
policy over the last 150 merges to master (2026-10-27): 38 merges (25%) were inflated that way, and
in every case the extra suites never loaded the file that triggered them (qa evidence, harness
scripts, the landing site, devcontainer, root config). Backend is the long pole (avg 628s, max
1379s), so a docs or evidence PR waited 10-23 minutes for a green that tested nothing relevant.

Blind spots found on the way:

- `src/landing/**` had no job; the landing build imports `@editor` modules from `src/frontend`, so
  frontend changes could break the deploy with nothing pre-merge.
- 8 `scripts/` tests ran in no workflow. `test_dotask_expert_matrix.py` was red on master.
  Two were not tests at all: `test_share_emails.py` sends real email, `migrations/test_migration.py`
  connects to staging.
- `.claude/hooks/lint-changed.cjs` (exits 0 on its own errors) and `.claude/skills/*/cleanup.py`
  were routed to suites that never execute them.
- Agent `tools:` only had to be non-empty; a reviewer could gain Edit/Write unnoticed.
- Knowledge docs held 51 dead path references (files deleted by code PRs) with no check.
- Master CI ran only frontend + backend.

## Solution

- Every routing rule names its consumer; an unclaimed path raises `UnclassifiedPath` and fails
  `changes` (and therefore `ci-ready`). `KNOWN_STRAYS` lists accidentally committed files.
- New `landing` job (`npm run build`) on `src/landing/**`, `src/frontend/**`, `pricing.json`.
- `CROSS_TREE_READS`: files one tree's code/tests read from another (backend tests run
  `scripts/delete_user.py` and friends, parse `useCrop.js`/`introCardGeometry.js` and the legal
  docs; the frontend imports `pricing.json` and parses `quest_config.py`; shrink-tool imports two
  frontend utils; `auth.py` reads `nuf-reset-emails.txt`). `test_ci_policy` re-derives the list
  (Python string constants outside docstrings; JS relative imports and `path.join(__dirname, ...)`),
  so a new cross-tree read fails tooling until it is listed.
- New `harness` job: syntax floor (py_compile, `bash -n`, `node --check`) plus the explicit
  `ci_policy.SCRIPT_TESTS` list, never a `test_*` glob.
- `scripts/check_doc_drift.py` in tooling: no new dead path refs vs the merge base (both doc and
  code PRs), no nonexistent code-shaped symbols on added doc lines, PLAN.md added links resolve and
  no duplicate task rows. Master runs the total-count ratchet (baseline 51).
- Read-only agents (reviewer, proof-verifier, merge-reviewer, code-expert, expert) can never be
  granted Edit/Write/NotebookEdit.
- Master CI runs all seven jobs unconditionally.

## Unchanged invariants

`aggregate` semantics; `changes` + `ci-ready` always required; jobs matched by key (no `name:`);
routing manifest schema; `policy_hash` = sha256 of `ci_policy.py` (all routing data lives there);
workflow/policy changes run every job and need policy review in `landing_gate.py`.

## Follow-ups (not in scope)

- Landing `astro check` (1 implicit-any error in `src/pages/index.astro`) and `verify-seo.mjs`
  (descriptions over length) fail on master today; add them to the landing job once fixed.
- Fix the 51 dead knowledge-doc references and ratchet `BASELINE` down.
- GitHub branch protection requiring `ci-ready` is not enabled (user decision).
- Doc-drift limits: dead refs are keyed on (doc, token), so repeating an already-dead token in the
  same doc is not new, and moving a doc re-reports its old dead refs; PLAN.md links that normalize
  outside the repo (the `../../../docs/plans/PLAN-archive.md` links) are skipped; a backticked
  runtime artifact that is not gitignored needs a history word or a fence.
- The cross-tree scan sees direct reads only (not transitive imports, and not the landing
  `@editor` alias, which is covered by routing all of `src/frontend/**` to landing).
