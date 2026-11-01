# T14290: database.py has mixed CRLF/LF line endings that break edits

**Status:** TODO
**Impact:** 2
**Complexity:** 1
**Tier:** S
**Created:** 2026-11-01
**Updated:** 2026-11-01

Found while landing T14150 (2026-11-01).

## Problem

`src/backend/app/database.py` is mixed on master: 2174 of 2212 lines are CRLF and the rest are LF.
- Editors and scripts normalize the whole file when they save it, which turns a 3-line change
  into a whole-file diff.
- The preland whitespace check flags CR on added lines.
- During T14150 the file had to be restored twice and patched byte by byte.

## Solution

A mechanical commit that converts the file to LF only, and adds a `.gitattributes` entry if
the repo's per-file convention calls for one. Make no other change in the same commit, so the
diff is reviewable with `git diff -w --ignore-cr-at-eol`. First check other backend files for
the same mix (`git ls-files --eol src/backend | grep mixed`) and fold them in.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py`
- `.gitattributes` (only if needed; note that editing it runs every CI job)

### Related Tasks
- None

## Acceptance Criteria

- [ ] `git ls-files --eol src/backend` reports no `mixed` files
- [ ] `git diff -w --ignore-cr-at-eol` against the previous commit is empty
