# T10340: `reset_user_id()` doesn't actually clear a leaked user-context contextvar

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

Found while fixing T10270's Branch CI failures. `app/user_context.py`'s `reset_user_id()` (test-only, meant to clear the current-user contextvar back to "unset" between tests) is implemented as:

```python
def reset_user_id() -> None:
    try:
        _token = _current_user_id.set("__reset__")
        _current_user_id.reset(_token)
    except ValueError:
        pass
```

`ContextVar.reset(token)` restores the value that was active **immediately before** the `.set()` call that produced `token` — it does not clear the var to "unset". So this function only works when `_current_user_id` was already unset when called (in which case it correctly restores "unset"). If an earlier test in the same process already called `set_current_user_id(...)` and never reset it, `reset_user_id()` silently no-ops: it briefly flips to `"__reset__"` then restores the leaked prior value, and `get_current_user_id()` keeps returning that stale id instead of raising.

T10270's own test (`test_terminal_without_user_id_skips_milestone`) hit exactly this — its docstring already predicted the leak ("other test modules leave a contextvar user_id set for the rest of the process") but the `reset_user_id()` call didn't actually fix it. Worked around there by monkeypatching the specific resolver instead of relying on `reset_user_id()`; this task is about fixing the shared mechanism itself.

## Solution

Give `_current_user_id` a real sentinel default so "unset" is representable and settable directly, instead of relying on token-based reset semantics:

```python
_UNSET = object()
_current_user_id: ContextVar[str] = ContextVar('current_user_id', default=_UNSET)

def get_current_user_id() -> str:
    value = _current_user_id.get()
    if value is _UNSET:
        raise RuntimeError(...)  # same message as today
    return value

def reset_user_id() -> None:
    """Clear the user context (used in test teardown)."""
    _current_user_id.set(_UNSET)
```

This mirrors the pattern already used by `_current_impersonator_id` (`default=None`) elsewhere in the same file.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/user_context.py` — `_current_user_id`, `get_current_user_id()`, `reset_user_id()`

### Related Tasks
- Found during T10270 (upload-failure observability)

### Technical Notes
- `_current_user_id` is module-private (leading underscore); grep confirms no direct external references — everything goes through `get_current_user_id()`/`set_current_user_id()`/`reset_user_id()`/`reset_user_id_token()`, so the blast radius is contained to this one file's four functions.
- `reset_user_id_token()` (the token-based restore-to-prior-value helper, used by real request-context code for foreign-profile JIT reads) is unaffected — it already does the right thing for its own use case and doesn't need this fix.
- This is shared test infrastructure used across the whole backend suite (4000+ tests). Before landing, run a broad regression pass, not just the T10270 corner — any test that happens to rely on the CURRENT (buggy) no-op behavior between tests would need to be found and fixed too. Likely none do, since the bug means "the context leaks across tests," which nothing should be relying on, but verify.

## Implementation

### Steps
1. [ ] Add `_UNSET` sentinel, give `_current_user_id` a `default=_UNSET`
2. [ ] Rewrite `get_current_user_id()` to check for `_UNSET` instead of catching `LookupError`
3. [ ] Rewrite `reset_user_id()` to a direct `.set(_UNSET)`
4. [ ] Run the full backend suite (not just T10270's tests) to confirm nothing relied on the leak

### Progress Log

**2026-09-17**: Filed from T10270's Branch CI investigation. Not fixed yet — T10270 worked around it locally instead of touching this shared file mid-task.

## Acceptance Criteria

- [ ] `reset_user_id()` reliably returns `get_current_user_id()` to a raising "unset" state regardless of what was set before it, in the same process
- [ ] Full backend suite still green
