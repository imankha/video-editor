# T4315: Stop the Local Copy From Being Authoritative Forever (restore-on-staleness)

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-24
**Epic:** [durability-sync](EPIC.md) · sibling of T4310 (upload-side CAS); this is the RESTORE side

## Problem

T4310 fixes the **upload** side (don't overwrite a version you didn't load). This task fixes
the **restore** side: a machine that already has a local DB never re-pulls a newer R2 copy, so
its local file is authoritative *forever*, and every sync force-pushes it (`skip_version_check
=True`). The two together are why a bad local snapshot silently wins.

Two live code paths, both proven on prod 2026-07-24 (arshia — 400 credits, then 5 reels):

1. **`ensure_user_database` (user_db.py:145-158)** restores `user.sqlite` from R2 **only when
   `local_version is None`** (first access). Once a machine has the file, it serves that copy
   for the process lifetime and never checks R2 again. So:
   - An admin credit grant lands in the machine's local `user.sqlite`. The middleware syncs the
     SESSION user (the admin), not the grantee (fixed separately — see landed fixes below), so
     the grant sits local-only. The next **deploy replaces the machine**; the fresh volume has
     `local_version is None`, pulls the R2 copy that never saw the grant, and it is gone.
     **This needs only ONE server** — machine replacement on deploy, not two live machines.
   - Editing R2 out-of-band while a session is live is futile: the live machine never re-reads,
     and its next write force-pushes over the edit. (Verified: a direct +400 R2 write was
     clobbered within minutes.)

2. **`ensure_profile_db_local` (materialization.py)** returns the **stale local copy** on an R2
   error when the file exists (it was written for read-only share resolution). `move_reels`
   reused it as a WRITE path and force-pushed `[stale snapshot + new row]`, reverting the target
   profile. **Point-fixed** by `require_fresh=True` (commit a5ff3e48) — but that is a per-caller
   guard, not the general rule.

The profile-DB **request** path already does the right thing: `ensure_database` +
`session_init` restore-if-newer on each request. The gaps are (a) `user.sqlite`, which never
re-pulls after first access, and (b) any writer that resolves a DB through a lenient,
read-optimized helper.

## Solution

Make "confirm current before you write" a property of the restore layer, not a per-caller
afterthought.

1. **`user.sqlite` restore-if-newer, not restore-if-absent.** Give `ensure_user_database` (or a
   sibling used by write paths) the same "HEAD, pull if R2 is newer than local" behavior the
   profile request path already has. Guard latency: only the write path needs freshness; reads
   can stay lenient. Reuse `sync_user_db_from_r2_if_newer` — it already returns
   `(downloaded, version, was_error)` and distinguishes NOT_FOUND from ERROR.
2. **Refresh-or-fail as the shared write-path rule.** Generalize `require_fresh` beyond
   move_reels: a writer resolving another user's / another profile's DB must either confirm the
   copy is current or raise (`ProfileDBRefreshFailed` pattern), never silently build on a stale
   or unconfirmed snapshot. Audit callers of `ensure_profile_db_local` / `_open_profile_db` /
   `get_user_db_connection(other_user)` for write intent.
3. **No force-push of an empty/materialized DB after an R2 error.** `_ensure_empty_profile_db`
   must only run on a genuine NOT_FOUND, never on ERROR (already gated in move_reels by
   require_fresh; make it structural).

Interlock with T4310: CAS on upload + restore-if-newer on read together close the loop —
neither alone is sufficient. CAS alone still serves stale reads; restore-if-newer alone still
lets two writers race the upload.

## Context

### Relevant Files
- `src/backend/app/services/user_db.py` — `ensure_user_database` (the `local_version is None` gate)
- `src/backend/app/services/materialization.py` — `ensure_profile_db_local` (`require_fresh` landed), `_open_profile_db` (raw connection, untracked)
- `src/backend/app/routers/admin.py` — `_refresh_target_user_db` (landed; the user.sqlite refresh-before-write pattern to generalize)
- `src/backend/app/database.py` — `get_local_user_db_version`, `sync_user_db_from_r2_if_newer` caller
- `src/backend/app/storage.py` — `sync_user_db_from_r2_if_newer` (NOT_FOUND vs ERROR return)

### Landed point-fixes (do NOT re-solve; generalize)
- **commit fec38d12 / e1e324ac** — admin credit writes sync the GRANTEE's `user.sqlite` and
  refresh-before-grant (`_refresh_target_user_db`). Closes the admin-specific hole; the general
  `user.sqlite` re-pull rule is this task.
- **commit b9302790** — `TrackedConnection` records `owner_user_id` / `owner_profile_id`; the
  middleware now syncs every DB a request wrote, not just the session user's. Fixes the
  cross-user *upload* gap; the *restore* gap is this task. NOTE the documented remainder: raw
  `_open_profile_db` connections are still untracked.
- **commit a5ff3e48** — `require_fresh` in move_reels. The narrow version of rule 2.

### Related Tasks
- Sibling of **T4310** (upload-side CAS) — same epic, must interlock.
- Feeds the **credits→Postgres** task (T5840): if credits leave the R2 blob, path 1's stakes
  drop from "silent money loss" to "stale read", but the `user.sqlite` staleness still matters
  for quests/reservations/preferences.

### Technical Notes
- Do NOT put a blocking HEAD on the read request path for every request (T2720 regression). The
  request path already restores via session_init; this is about the write-before-read-confirm
  discipline and the `user.sqlite` gap specifically.
- `_initialized_user_dbs` caches "this machine has seen this user" — the gate that must learn to
  re-check R2 for writers.

## Acceptance Criteria

- [ ] A write to `user.sqlite` on a machine holding a stale copy either sees the current R2
      version first or fails loudly — never force-pushes stale-plus-delta
- [ ] An out-of-band R2 edit to `user.sqlite` is picked up by a live session's next write path
      (regression: the clobber that happened 2026-07-24 cannot recur)
- [ ] No writer builds on a stale copy after an R2 error (generalized `require_fresh`)
- [ ] Read/share paths keep lenient behavior; p50 request latency unchanged
- [ ] Test: machine-replacement simulation (drop local + version cache) loses no committed write
