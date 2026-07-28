# T6160: A CAS conflict never self-heals — the machine can't notice R2 moved, so Retry can never succeed

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-07-28
**Found by:** the user hitting it live on staging 2026-07-27 — "nothing saves, everything breaks",
framing drags snapping back, `saveClip got HTTP error: 503`, and the
*"Could not save to the cloud / A newer version…"* alarm on every gesture

## What happens

`ensure_database()` (`app/database.py:~657`) restores a profile DB from R2 **on first access only**:

```python
# If R2 is enabled, download from R2 only on first access (no local DB yet)
# We do NOT check R2 version on every request - that HEAD request is slow (20s+ when cold)
if R2_ENABLED:
    local_version = get_local_db_version(user_id, profile_id)
    # Only download from R2 if we've never synced for this user+profile (first access)
    if local_version is None:
        ...
```

Once `local_version` is set, the running machine **never re-checks R2 again**. If R2's copy moves
ahead out-of-band — an env copy, an admin restore, another machine — the machine keeps its stale
loaded-from version indefinitely.

Every subsequent write then hits the T4310 upload-side CAS guard, which correctly refuses to
overwrite newer state: **503 `sync_failed`**, and the frontend surfaces
*"Could not save to the cloud — A newer version…"* with a **Retry** button.

**The Retry can never succeed.** Retrying re-runs the same write with the same stale loaded-from
version, hits the same conflict, and 503s again. The only escape is a process restart, which clears
the in-memory version and forces a first-access restore.

## Measured evidence (staging, 2026-07-27/28)

- R2 `staging/users/3ed03fb5…/profiles/9fa7378c/profile.sqlite` — LastModified **22:35:31Z**,
  metadata `db-version: 2575`.
- The user tested **after** that upload, on a machine that had been running since before it, and
  every gesture 503'd: framing drag reverted, annotation save failed, export rendered but could not
  record (`Render finished but couldn't save to the cloud`).
- Machine suspended 23:51:44Z; on the 00:18:00Z restart the local copy was **absent**, so the next
  access does a clean first-access restore of version 2575 and writes work again.

Note the failure is silent about its own cause: the user sees "a newer version exists", which is
true, but nothing tells them (or the app) that the fix is a restart and that Retry is futile.

## Why this is Impact 8 and not just an ops footgun

The CAS refusal itself is **correct** and must not be weakened — freezing the write is what stops a
stale machine force-pushing over newer state (CLAUDE.md § *A write path must prove its copy is
current, or fail loudly*). The defect is the **absence of recovery**:

1. A user in this state loses every gesture until someone restarts a machine they cannot see.
2. The offered affordance (Retry) is guaranteed to fail, which is worse than offering nothing —
   the app is telling the user to do something that cannot work.
3. It is not staging-only. Any out-of-band R2 write reaches this state: an admin restore, a support
   fix, a second machine, a future multi-machine deployment. Sessions are not pinned to one machine
   (memory `project_fire_and_forget_deferred`), so this is reachable in prod.

## What to do

The obvious fix (HEAD R2 on every request) is explicitly rejected in the code comment — 20s+ when
cold. Do not reintroduce it. Instead, make the conflict itself the trigger:

1. **On a CAS conflict, invalidate the cached local version** (`set_local_db_version(..., None)`)
   so the *next* request performs a first-access restore and picks up R2's newer copy. That turns a
   permanent dead end into a self-healing one, costs one HEAD only when a conflict actually
   happened, and keeps the "never blindly overwrite" guarantee intact.
2. **Decide what happens to the refused write.** After re-pulling, the user's in-flight edit is
   against a stale base. Re-applying it blindly would silently clobber the newer state that the CAS
   guard just protected — that is the whole point of the guard. Options: discard and tell the user
   to redo, or surface a real conflict UX. **Argue this explicitly; do not auto-merge**
   (CLAUDE.md: "never auto-merge, never blind-retry an overwrite").
3. **Fix the Retry affordance** so it does not promise something it cannot deliver in this state.
   Either it triggers the re-pull from (1), or it is replaced with an honest "reload required".
4. Check whether `user.sqlite` has the same shape — memory `reference_user_sqlite_local_authoritative`
   records that a live machine never re-pulls it, which is the same class and may need the same
   treatment. State a decision either way.

## Watch out for

- **Do not weaken the CAS guard.** It is protecting real data. The bug is recovery, not detection.
- Do not add a per-request R2 HEAD; the comment documents why (20s+ cold).
- The frontend already distinguishes `conflict` from `failed` (T5960/T6010). Coordinate — a fix here
  may change which alarm fires, and those tasks deliberately gated the alarm on write-attempt.
- Reproduce it properly: upload a newer `profile.sqlite` to R2 behind a running backend, then
  attempt a gesture write. A unit test can simulate it by setting the cached version below R2's.

## Acceptance criteria

1. A test reproducing the dead-end: stale cached version + newer R2 copy → write refused → **and
   today, the next write is refused identically** (proving no self-heal). Red-first.
2. The fix, with the CAS refusal itself still intact and still refusing to overwrite newer state.
3. A written decision on the refused in-flight write (discard vs conflict UX) — never auto-merge.
4. A stated decision on whether `user.sqlite` shares the defect.
5. Backend suite green. **Baseline on master 2026-07-27: 2414 passed, 16 skipped, 0 failed.**
