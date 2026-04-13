# T1270: Cookie Path + SameSite Fix

**Status:** DONE
**Impact:** 9
**Complexity:** 1
**Created:** 2026-04-10

## Problem

Two cookie bugs that cause session loss:

1. All `set_cookie()` calls omit `path` — browser scopes cookie to request path, so it may not be sent on different routes.
2. SameSite logic is inverted: `"none" if _SECURE_COOKIES else "strict"`. Production should use `lax`.

## Solution

Add `path="/"` and change SameSite to `lax` on all `set_cookie()` calls.

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` — lines 130-132 (SameSite), lines 561-568, 670-677, 924-930, 979-986 (set_cookie calls)

### Related Tasks
- Part of Auth Integrity epic
- Do this first — cookie must work before other auth changes

## Implementation

### Steps
1. [ ] Change `_SAMESITE = "lax"` (remove conditional)
2. [ ] Add `path="/"` to all `set_cookie()` calls (4 locations)
3. [ ] Verify no other files set `rb_session` cookie

## Acceptance Criteria

- [x] All `set_cookie("rb_session", ...)` calls include `path="/"`
- [x] SameSite is `lax` in all environments
- [ ] Google OAuth redirect still works (manual verification required — AWAITING USER VERIFICATION)

## Result

**Branch:** `feature/T1270-cookie-path-fix`

**Test:** `src/backend/tests/test_auth_cookie_config.py` (AST inspection over
`app/routers/auth.py` — covers every `rb_session` `set_cookie`/`delete_cookie`
call site).

### Before (on this branch prior to fix)

```
tests/test_auth_cookie_config.py::test_rb_session_calls_found PASSED
tests/test_auth_cookie_config.py::test_every_rb_session_call_has_path_root FAILED
tests/test_auth_cookie_config.py::test_every_rb_session_call_uses_samesite_lax FAILED

AssertionError: rb_session cookie call(s) missing path="/" at auth.py lines:
  [561, 670, 924, 945, 979]
AssertionError: rb_session cookie call(s) not using samesite="lax":
  [(561, None), (670, None), (924, None), (945, None), (979, None)]

2 failed, 1 passed in 0.14s
```

(samesite resolved to `None` because `_SAMESITE` was a ternary expression,
not a plain string literal — the AST test couldn't resolve a ternary. Once
`_SAMESITE = "lax"` is a literal, it resolves correctly.)

### After (fix applied)

```
tests/test_auth_cookie_config.py::test_rb_session_calls_found PASSED
tests/test_auth_cookie_config.py::test_every_rb_session_call_has_path_root PASSED
tests/test_auth_cookie_config.py::test_every_rb_session_call_uses_samesite_lax PASSED

3 passed in 0.04s
```

### Full backend suite

`run_tests.py` → 664 passed, 15 failed, 6 errors, 6 skipped. All 15 failures
are pre-existing and unrelated to auth cookies (test_admin credit balance,
test_guest_migration, test_migration_recovery, test_sync_retry
`ImportError: retry_pending_sync`, test_version_conflict, and
test_annotations_aggregates `/api/games 404`). No auth tests regressed.

### Changes

- `src/backend/app/routers/auth.py`:
  - `_SAMESITE = "lax"` (was `"none" if _SECURE_COOKIES else "strict"`).
  - Added `path="/"` to all 4 `set_cookie("rb_session", ...)` calls (google_auth,
    init_guest, OTP verify, test-login).
  - Added `path="/"` to the `delete_cookie("rb_session", ...)` in logout so
    the cookie is actually cleared.
- `src/backend/tests/test_auth_cookie_config.py` (new): AST-based regression
  test.
