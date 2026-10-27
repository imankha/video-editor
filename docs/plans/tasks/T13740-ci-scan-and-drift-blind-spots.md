# T13740: Close the known blind spots in the cross-tree scan and doc-drift check

**Status:** TODO
**Impact:** 3
**Complexity:** 4
**Created:** 2026-10-27
**Follow-up of:** T13710

## Problem

T13710's review recorded limits that do not cause a misroute today but could later:

Cross-tree scan (`cross_tree_reads` in `scripts/test_ci_policy.py`, which pins
`ci_policy.CROSS_TREE_READS`):
- Python: misses single strings containing `/` (`"docs/legal/x.md"`), extensions outside
  py/js/jsx/mjs/md/txt/json/ts (`.sh`, `.yml`, `.toml`, `.sql`, `.html`, extensionless files),
  basenames that also exist under `src/backend/`, and directory reads/globs.
- JS: misses `new URL(..., import.meta.url)`, `import.meta.glob`, joins off a variable base
  (`path.resolve(REPO_ROOT, ...)`), `?raw`/`?url` imports, and frontend `.ts/.tsx`.
- Direct reads only, not transitive imports.

Doc drift (`scripts/check_doc_drift.py`):
- Dead refs are keyed on (doc, token): repeating an already-dead token in the same doc is not
  flagged, and moving a doc re-reports its old dead refs as new.
- PLAN.md links that normalize outside the repo (`../../../docs/plans/PLAN-archive.md`) are skipped.
- A backticked runtime artifact that is not gitignored needs a history word or a fence.

## Solution

Extend the scan patterns for the listed forms, with a fixture test per form that fails before the
extension. For drift, key dead refs per occurrence (doc, line text, token) and resolve PLAN.md
relative links correctly. Every change to `ci_policy.py` or the workflows needs explicit policy
review (`landing_gate.py`).

## Acceptance

- Each listed form has a red-first fixture test that now passes.
- `test_files_read_across_trees_route_to_the_reading_layer` still finds no misroutes on master.
