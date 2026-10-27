# T13750: Require ci-ready on master with GitHub branch protection

**Status:** TODO (user decision)
**Impact:** 6
**Complexity:** 1
**Created:** 2026-10-27
**Follow-up of:** T13710

## Problem

`master` has no branch protection (`gh api repos/imankha/video-editor/branches/master/protection`
returns 404). The Landing Policy's "green required CI for the exact head SHA" is enforced only on
the supervised path (`scripts/landing_gate.py`); a direct merge or push to master skips it.
CLAUDE.md already says so ("Never claim it prevents direct merges on an unprotected branch").

## Decision needed

Whether to require the `ci-ready` check (and optionally up-to-date branches) for merges to
master. Effects: every PR must have green Branch CI before GitHub allows the merge; direct pushes
to master (e.g. docs-only "plan updates" commits) would need a PR or an admin bypass, which
changes how sessions currently file PLAN.md updates.

## Solution (after the user decides)

Apply the protection rule via `gh api -X PUT .../branches/master/protection` (or the GitHub UI)
with required status check `ci-ready`; decide on admin bypass and on whether docs-only commits
still go straight to master. Update CLAUDE.md's Landing Policy note about unprotected branches.
