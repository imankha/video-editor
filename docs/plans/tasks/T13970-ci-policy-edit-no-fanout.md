# T13970: Editing ci_policy.py no longer fans out to every Branch CI job

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

`scripts/ci_policy.py` and `scripts/test_ci_policy.py` sit in the `EVERYTHING` set, so any
edit to them runs every Branch CI job. In practice the common edit is a one-line routing entry
(e.g. T13910 added `scripts/email_subscribers.py` to `CROSS_TREE_READS`), and that one line
started the full frontend and shrink suites on a PR that touched no frontend code (seen
2026-10-29, the T13910 PR).

## Solution

Remove the two router files from `EVERYTHING` and route them to `tooling` (which runs
`test_ci_policy.py`). Keep `.gitattributes` and `.github/workflows/*` in the full fan-out.
To guard against a bad rule silently skipping a layer, add a check to `test_ci_policy.py`
that re-routes every tracked file in the repo under the new policy and fails when a file that
used to map to a job now maps to fewer jobs and is not listed in an explicit
"intentional narrowing" set in the same diff. A routing regression then fails tooling instead
of waiting for Master CI.

## Context

### Relevant Files (REQUIRED)
- `scripts/ci_policy.py` - `EVERYTHING`, `jobs_for`
- `scripts/test_ci_policy.py` - new narrowing guard
- `CLAUDE.md` (Test Scope Policy paragraph on Branch CI)

### Related Tasks
- Sibling: T13950, T13960

## Acceptance Criteria

- [ ] A diff touching only `scripts/ci_policy.py` requires `changes` + `tooling` only
- [ ] A rule change that removes a job from any tracked path fails `test_ci_policy.py` unless declared
- [ ] `.gitattributes` and workflow edits still run everything
