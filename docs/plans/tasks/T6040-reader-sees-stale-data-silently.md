# T6040: A reader on a conflicted machine now browses stale data silently — give the reader a quiet "newer version available / Reload"

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-27
**Follows:** T5960 + T6010 (both merged to master 2026-07-27). Read both task files first.

## Problem

T5960 (and T6010, which generalised it) suppress the sync alarm until the current session has
attempted a write. That correctly stopped telling a passive reader *"Could not save to the cloud"*
for work they never did. But the suppressed banner was the **only** user-visible signal that the
machine is serving stale data, and the **only** affordance to fix it.

Net effect today: a reader on a conflicted machine sees nothing, browses stale data indefinitely,
and has no way to recover.

## Traced (verified by code read 2026-07-27 — do NOT re-derive)

1. **The read path never refreshes.** `ensure_database()` (`database.py:653-663`) restores from R2
   only when `local_version is None` — restore-if-**absent**, not restore-if-newer. The inline
   comment is explicit that a per-request HEAD would cost 20s+ cold. A conflicted machine *has* a
   local version (it is merely behind R2), so this branch never fires for it.
2. **The staleness is durable.** `get_local_db_version` falls back to reading the version out of the
   DB file, and `set_local_db_version` persists it there, deliberately so it survives a process
   restart. A stale machine does not self-heal by cycling.
3. **Retry genuinely works — do not "fix" it.** `POST /api/retry-sync` -> `_retry_resolve_conflict`
   (`routers/health.py:225`) calls `confirm_current_before_write` for both `user.sqlite` and the
   profile DB, which is real restore-if-newer, then clears the markers and reports honestly.
   (Note: `middleware/db_sync.py: retry_pending_sync` is a DIFFERENT, background path that only
   re-refuses — do not confuse the two.)
4. **The frontend already handles the restore response.** `syncStore.retrySyncToR2` branches on
   `data.restored` -> `stashRestoredNotice()` + `reloadPage()`. The reader path can reuse this
   endpoint as-is; no backend change is needed.

## Why `conflict` and `failed` are NOT symmetric here

This is the core of the design — encode it, do not flatten it:

- **`conflict`** = CAS refused because `r2_version > current_version`. R2 is **ahead**; the local
  copy is **behind**. A reader on this machine is looking at **stale** data and genuinely needs to
  know. -> reader gets a quiet notice + Reload.
- **`failed`** = an upload did not land for some other reason. The local copy is **ahead** (it holds
  unsynced changes); a reader on this machine is looking at the **newest** data. There is nothing
  for a reader to do. -> stays silent for readers, exactly as T6010 shipped it.

So this task changes the reader treatment of `conflict` only. **T6010's `failed` gating is correct
and must not be touched.**

## Decision (implement this)

Two presentations of one state, split by the `hasAttemptedWrite` signal that already exists:

| Session | State | Presentation |
|---|---|---|
| Wrote this session | `conflict` | **Unchanged** — today's red alarm, "Could not save to the cloud", Retry |
| No write this session | `conflict` | **New** — quiet, non-alarm notice: "A newer version of your work is available" + **Reload** |
| No write this session | `failed` | **Unchanged** — silent (see asymmetry above) |
| Any | `pending` / offline | **Unchanged** |

Reader-path specifics:

- Style it like the existing quiet banners (the `pending` / offline variants in
  `SyncStatusIndicator.jsx`), NOT the red alarm. No `AlertTriangle`, no red border, no "could not
  save" — the reader has not failed at anything.
- Label the button **Reload**, not Retry. For a reader the operation is "load the newer copy", and
  the honest-refusal copy the backend returns on failure already says "Please reload the page to
  continue."
- It can call the same `retrySyncToR2` path. **But** `_retry_resolve_conflict` returns
  *"Your local changes were replaced by a newer version saved elsewhere"* — that is wrong for a
  reader, who has no local changes to lose. Either branch the stashed notice on whether this session
  wrote, or give the reader path its own notice text. Do not show a reader a message about losing
  work they never did — that is the same class of bug T5960 set out to fix.
- `POST /api/retry-sync` first attempts `sync_db_to_cloud()`, which for a reader is a refused
  upload of an unmodified local DB before it reaches the restore branch. Verify this is harmless
  (CAS refuses it; it should only re-mark an already-set marker) and say so in your report. If it
  turns out to have a side effect, report it — do NOT restructure the endpoint in this task.

## Must not break

1. The writer path is untouched: a user who wrote this session still gets the red alarm + Retry, and
   `stashRestoredNotice`'s existing "your local changes were replaced" warning still reaches them.
   That warning exists because their unsynced edit really is discarded (T5870 round-2 BLOCKING) —
   never weaken it for a writer.
2. `failed` stays silent for readers (T6010's gating), `pending` stays quiet and ungated,
   offline unchanged.
3. `SHOW_DELAY_MS` grace still applies — the reader notice must not flash on a momentary state.
4. Stays green: `syncStore.test.js`, `SyncStatusIndicator.test.jsx`,
   `e2e/T5960-conflict-alarm-gated-on-write.spec.js`,
   `e2e/T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js`, and backend
   `test_t5870_pending_vs_failed.py`, `test_sync_status.py`, `test_background_sync.py`.

## Acceptance criteria

- [ ] `conflict` + zero writes this session -> a **quiet, non-alarm** notice renders with a Reload
      action (NOT the red "Could not save to the cloud" alarm).
- [ ] `conflict` + a write this session -> today's red alarm + Retry, byte-for-byte unchanged
      (regression pin).
- [ ] `failed` + zero writes -> still renders nothing (T6010 regression pin).
- [ ] `pending` -> still renders its quiet banner regardless of write-attempt.
- [ ] The reader's Reload reaches the restore path and the page ends up on the newer data; the
      reader is NOT told their local changes were replaced.
- [ ] The first criterion is RED before the fix.

## Knowledge

`.claude/knowledge/persistence-sync.md` — §T4310/§T4315 and the T5960/T6010/T6020 surfacing section.
Add the reader-vs-writer split AND the `conflict`-is-behind / `failed`-is-ahead asymmetry at Stage 7;
that asymmetry is the non-obvious fact this task establishes and the next agent will need it.
