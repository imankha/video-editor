# T3340: Thread-Safe Session Init Cache

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P0
**Complexity:** 2
**Impact:** 7
**Status:** TODO

## Problem

`_init_cache` in `session_init.py` is a plain Python dict accessed by multiple threadpool workers without synchronization. When 4-5 concurrent requests arrive simultaneously during Phase 2 (credits, admin/me, settings, pending-uploads), multiple threads check the cache, find it empty, and all run the expensive R2 download path redundantly.

## Evidence

- session_init.py:26 -- `_init_cache` is a plain dict
- session_init.py:57-60 -- cache check with no lock
- Phase 2 fires 4 requests without X-Profile-ID, each triggering `user_session_init()` in middleware (db_sync.py:503-507)
- R2 downloads are idempotent but each takes ~500-900ms -- redundant calls waste 1-3s

## Implementation

Add a per-user `threading.Lock` around the slow path in `user_session_init()`:

```python
import threading

_init_locks: dict[str, threading.Lock] = {}
_init_locks_guard = threading.Lock()

def _get_init_lock(user_id: str) -> threading.Lock:
    with _init_locks_guard:
        if user_id not in _init_locks:
            _init_locks[user_id] = threading.Lock()
        return _init_locks[user_id]

def user_session_init(user_id):
    cached = _init_cache.get(user_id)
    if cached:
        set_current_profile_id(cached["profile_id"])
        return cached

    with _get_init_lock(user_id):
        # Double-check after acquiring lock
        cached = _init_cache.get(user_id)
        if cached:
            set_current_profile_id(cached["profile_id"])
            return cached
        # ... existing slow path (R2 downloads) ...
```

This ensures only one thread per user runs the R2 download; all others wait on the lock and read from cache.

## Files

| File | Change |
|------|--------|
| `src/backend/app/services/session_init.py` | Add per-user lock around `user_session_init()` slow path |

## Acceptance Criteria

- [ ] Only one R2 download per user per machine boot (not one per concurrent request)
- [ ] Concurrent requests for the same user block on the lock and read cached result
- [ ] No deadlock risk (lock is per-user, not global)
- [ ] Lock dict doesn't leak indefinitely (acceptable for now -- one Lock per user who hits the server, and machines restart frequently)
