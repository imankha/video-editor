# T4790: Clear the backend ruff + frontend eslint backlog

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Priority:** P2
**Created:** 2026-07-05
**Updated:** 2026-07-05

## Why

The PostToolUse lint hook (`.claude/hooks/lint-changed.cjs`) runs `ruff check`
(backend) / `eslint` (frontend) on **every file it touches** and blocks until the
**whole file** is clean. Both trees carry a large pre-existing backlog, so any edit
to a dirty file forces an unrelated cleanup mid-task (this task was spun off from the
T-draft-delete bug fix, where `projects.py` alone reported 62 errors for an 11-line
change). Clearing the backlog removes that friction and surfaces the handful of real
bugs hiding among the style noise.

## Scope (measured 2026-07-05)

| Tree | Tool | Count | Notes |
|---|---|---|---|
| `src/backend/app` | `ruff check` | **1925 errors** across ~240 locations | 1445 auto-fixable (`--fix`), 220 more with `--unsafe-fixes` |
| `src/frontend/src` | `eslint` | **1027 problems** (23 errors, 1004 warnings) | only ~12 auto-fixable |

Dominant backend categories: `UP045` (`Optional[X]` -> `X | None`), `UP006`
(`List` -> `list`), `I001` (import sorting), `F401` unused imports. Also present and
**not** pure style — triage these as possible real bugs first:
- `F821` undefined-name (5)
- `F811` redefined-while-unused (4)
- `B006` mutable-argument-default (3)
- `B030` except-with-non-exception-classes (1)
- `E712` true/false comparison (6), `SIM` simplifications

## Approach

1. **Bugs first, separately.** Before any bulk autofix, hand-review every `F821`,
   `F811`, `B006`, `B030` and confirm each is dead style vs a latent bug. Fix real
   bugs in their own commits with a test where behavior could change.
2. **Backend bulk.** Run `ruff check --fix` (safe fixes only — NOT `--unsafe-fixes`
   in bulk) in reviewable batches (by router/service directory). Keep `--unsafe-fixes`
   out of scope unless individually reviewed. `ruff format` is out of scope unless the
   team opts in — decide up front.
3. **Frontend.** `eslint --fix` handles little here; the 23 hard errors are the
   priority (they can mask real problems). Warnings (1004) can be a follow-up wave or
   downgraded/configured if they are noise (e.g. intentional patterns).
4. **Verify.** `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`
   plus `run_tests.py`; frontend `npm test`. A pure-style pass should not change any
   test outcome — if it does, that fix was not pure style.
5. **Guardrail (optional, recommend).** Once green, consider a CI check (or extend the
   hook) so the backlog can't silently regrow.

## Acceptance criteria

- [ ] `ruff check src/backend/app` reports 0 errors (or a documented, config-encoded
      ignore list for rules the team deliberately rejects).
- [ ] `eslint src/frontend/src` reports 0 **errors** (warnings may be tracked
      separately if a follow-up is agreed).
- [ ] Every `F821`/`F811`/`B006`/`B030` was reviewed and any real bug fixed with a test.
- [ ] Backend imports + full test suite pass; frontend unit tests pass.
- [ ] Commits are batched/reviewable (not one 2000-line dump); behavior-changing fixes
      are isolated from pure-style churn.

## Notes

- This is deliberately mechanical but large — good candidate to fan out per-directory
  once the bug-triage pass (step 1) is done.
- Do the bug-triage pass EVEN IF the rest is deferred; the real bugs are the reason
  this is worth more than cosmetic.
