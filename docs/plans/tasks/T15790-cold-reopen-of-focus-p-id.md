# T15790: Cold-reopen of /focus/p/<id> from a closed tab still does not load the Frame editor within 10s

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the /dotask verifier on group g-t15410-4 at d20fb02e2, which judged it unrelated to that branch. Impact and complexity are unscored defaults.

**Steps:** Run src/frontend/e2e/checks/T15410.check.spec.js (or manually: log in, open /focus/p/<id> for a project with a clip, let the video load, close the tab, wait 2s, open a fresh tab to /, within 10s).

**Expected:** Frame editor (with a playing video at the resumed path) renders within 10s of the cold reopen.

**Actual:** The resumed path/video did not become ready within 10s in this sandbox. Root cause is not this branch's code: the sandbox's vite dev server answers every request -- including its own static index.html and unrelated API endpoints proxied through it -- in ~9-11s uniformly, confirmed by direct curl timing independent of this task's code path. git diff against master shows no change to vite.config or package.json on this branch, so the same dev-server overhead would reproduce identically on master; this is sandbox resource contention, not a defect this branch introduced or left unfixed.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
