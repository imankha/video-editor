# T1270: Cookie Path + SameSite Fix

**Status:** TODO
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

- [ ] All `set_cookie("rb_session", ...)` calls include `path="/"`
- [ ] SameSite is `lax` in all environments
- [ ] Google OAuth redirect still works
