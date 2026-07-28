# T6160 — CAS conflict self-heal: design & decisions

Stage 2 (Architect design gate) is skipped for this M-tier task, but the kickoff
requires **decision 2 argued in writing before any code is written**. This
document does that, and records the three sibling decisions so the reviewer and
the next person can check the reasoning against the code.

The one rule that governs every decision below: **the CAS refusal is correct and
must not be weakened.** The bug is the *absence of recovery*, not the detection.
If any decision here made a write succeed against a stale base, it would
reintroduce exactly the clobber CAS exists to prevent, and it would be wrong.

---

## The defect (confirmed against the code, not re-derived)

`ensure_database()` (database.py:657) and `ensure_user_database()` (user_db.py:145)
restore from R2 **on first access only** — gated on `local_version is None`
(profile) / `local_version is None` *and* not in `_initialized_user_dbs` (user).
The code comment rejects a per-request HEAD (20s+ cold). Consequence: once a
running machine has a version cached, it **never notices R2 moving ahead**
out-of-band (env copy, admin restore, a second machine). Every write then hits
the T4310 upload-side CAS guard, which correctly refuses → `.sync_conflict` →
the frontend's *"Could not save… a newer version"* + **Retry**, or a durable
`503 sync_failed`. Only a process restart escapes (ephemeral disk gone → file
absent → `local_version is None` → first-access restore).

**Two confirmations that the naive fix is insufficient:**

1. `set_local_db_version(user_id, profile_id, None)` **only pops the in-memory
   cache** (database.py:469-472). It does *not* clear the `db_version` row
   persisted in the profile.sqlite file. `get_local_db_version` falls back to
   reading that row (database.py:426-434), so the stale version is *resurrected*
   on the next read and no first-access restore happens. The kickoff's suggested
   one-liner therefore does not, by itself, self-heal on a running machine whose
   file is still on disk.
2. The "simulate machine cycle" test seam (test_seams.py:259-269) has to clear
   the version cache **and delete the local files** — its own comment says "the
   un-synced delta lives only here." That is the code confirming (1).

For `user.sqlite` the version cache is memory-only (no persisted file row), but
`ensure_user_database` **early-returns on `_initialized_user_dbs` membership**
(user_db.py:130-134) *before* it ever looks at the version — so clearing the
version alone still does nothing there either.

---

## Decision 1 — self-heal trigger: invalidate on conflict, re-pull on next request

On a CAS conflict, invalidate the loaded-from version so the **next** request's
first-access path re-pulls R2's newer copy. This costs **one HEAD only when a
conflict actually happened** — it does not reintroduce the per-request HEAD the
comment rejects.

To make invalidation *real* (per the confirmations above) it must:

- **profile.sqlite:** pop the in-memory cache **and delete the persisted
  `db_version` row** from the file, and clear the restore cooldown (a conflict
  means R2 was reachable, so any prior transient-error cooldown is stale). Then
  `get_local_db_version` returns `None` → `ensure_database` re-pulls.
- **user.sqlite:** pop the in-memory cache, **discard `_initialized_user_dbs`**,
  and clear the user restore cooldown. Then `ensure_user_database` re-pulls.

Single choke points cover every path:
- `sync_db_to_r2_explicit` / `sync_user_db_to_r2_explicit` conflict branches —
  used by `_background_sync` for the **session user and every foreign user**
  (admin grant / share / webhook).
- `retry_pending_sync`'s profile + user conflict branches (it calls the
  lower-level primitives directly, so it needs the call explicitly).

**WAL safety of the deferred re-pull (required, not optional).** `ensure_database`
/`ensure_user_database`'s first-access download had **no** WAL guard — safe when
"first access" genuinely means "no connections yet," but this task now triggers
that path on a *running* machine where a live connection can hold the file open
(`-wal`/`-shm` present). Blindly swapping the main file then lets the next
connection replay the old WAL onto the new file (cross-DB page mixing — the exact
hazard T4310 removed its post-conflict re-download for). So both first-access
restores gain the same `before_download=lambda: not wal_sidecars_present(...)` +
`clear_stale_wal_sidecars(...)` guard `ensure_profile_db_local`/
`ensure_user_database_fresh` already use. If a live connection blocks the swap,
the re-pull is refused (transient) and retried on a later request — never an
unsafe swap. This also *hardens* the genuine-first-access path against
crash-leftover sidecars; it does not change its behavior when none are present.

**Why this stays safe while unhealed:** with the version cleared to `None`, the
storage-side CAS guard's BLOCKING-2 rule (`current_version is None` + real R2
content → refuse) keeps *writes* refusing until the re-pull succeeds. So there is
no window where a stale write can land — the machine simply keeps refusing +
re-pulling until local == R2, then writes resume. No loop (each success sets the
real version), self-limiting under genuine multi-writer contention.

---

## Decision 2 — the refused in-flight write is DISCARDED (argued)

**Decision: discard it. The self-heal re-pull overwrites the local file, and the
superseded edit is gone from disk. We never re-apply it and never merge it.**

Context: the refused write already committed to the **local** profile.sqlite (the
local commit succeeds; only the R2 *upload* is refused, baseline frozen). When
the next request re-pulls R2's newer copy, `download_from_r2` atomically replaces
the local file → the local edit is discarded.

Why discard is the only correct choice:

1. **Re-applying it is the banned clobber.** R2's copy is newer because *another*
   writer (machine / env-copy / admin restore) advanced it. Writing our
   stale-based edit on top either reverts those newer changes or fabricates a
   merged state neither writer authored. CLAUDE.md rule 7: *never auto-merge,
   never blind-retry an overwrite.* This is the whole reason CAS froze the
   baseline.
2. **The edit's intent may be invalid against the new base.** It was computed
   against the stale snapshot (e.g. it edits a clip that no longer exists at the
   newer version). We cannot know the user's intent for a base they never saw, so
   we must not guess by replaying.
3. **Discard is the only option that preserves the guarantee** "newer state is
   never silently overwritten." Every alternative that keeps the edit has to put
   it *somewhere*, and the only somewheres are (a) over R2 = clobber, or (b) a
   real 3-way merge UI = a feature, not a recovery fix.

Why discard is **acceptable and not silent data loss** — the visibility
requirement this decision imposes on Decision 3:

- The discard **must be user-visible**. A silent discard (UI still shows the
  edit, DB no longer has it) is a divergence bug. Discard is only legitimate
  *because* the existing conflict UX already surfaces it:
  - **fire-and-forget path:** `.sync_conflict` → `X-Sync-Status: conflict` →
    `SyncStatusIndicator` alarm (write-attempt-gated, T5960/T6010) → Retry →
    `_retry_resolve_conflict` restores-if-newer, stashes the "Your local changes
    were replaced by a newer version" notice, and reloads so in-memory state
    matches the restored DB (T5870).
  - **durable path:** `503 sync_failed` keeps the card/state in place (never an
    optimistic apply) and offers Retry.

**Rejected alternatives:** re-apply after re-pull (clobber, banned); auto-merge
(banned); stash-and-replay-after-reload (a genuine conflict-resolution feature —
replaying against a changed base is itself risky, and it is out of scope for a
recovery bug; noted as possible future work).

---

## Decision 3 — the Retry affordance becomes honest *because* Decision 1 makes it work

The kickoff: Retry must stop promising the impossible — either it triggers the
re-pull, or it becomes an honest "reload required." Decision 1 makes **both
existing affordances honest with no change to their gestures**:

- **Durable `503 sync_failed` Retry** (re-runs the write): the retried request
  hits `ensure_database` first, which now re-pulls R2 (self-heal), so the handler
  runs against the *current* base, CAS passes, and the write lands. The first
  attempt's local commit was discarded by the re-pull (Decision 2), so there is
  no double-apply. The affordance now delivers instead of looping forever.
- **`SyncStatusIndicator` banner Retry** (`/api/retry-sync`): already
  restores-if-newer for a conflict (T5870) and reloads with the honest notice.
  With Decision 1 the machine may already have self-healed by the time the user
  clicks; the restore is then a no-op that still reloads to resync in-memory
  state. Still honest.

**No frontend code change is required for Decision 3**, and this is deliberate: it
avoids touching the write-attempt gating T5960/T6010 built (which must not be
undone). The claim "the durable Retry now succeeds" is proven by a backend test
(the second write after a conflict re-pulls and returns OK) and must be
spot-checked in QA. If QA shows any affordance still dead-ends, that is a new
finding to fix — but the mechanism above says it will not.

---

## Decision 4 — user.sqlite gets the same treatment

Memory `reference_user_sqlite_local_authoritative`: a live machine never re-pulls
`user.sqlite` once cached — the same class of defect. It is even stickier
(`ensure_user_database` early-returns on `_initialized_user_dbs` before the
version check). So `user.sqlite` gets the same self-heal: on a `user.sqlite` CAS
conflict, invalidate its version, discard the init flag, clear its cooldown, and
add the WAL guard to `ensure_user_database`'s first-access restore. Its version is
memory-only, so there is no persisted file row to clear.

---

## Acceptance-criteria → evidence map

1. Red-first test: stale cached version + newer R2 → write refused → **next write
   refused identically today** (no self-heal). → `test_t6160_conflict_self_heal.py`
   asserts, on the unfixed code, that a second `ensure_database` + write still
   conflicts and no download happened; after the fix the second write re-pulls
   and returns OK.
2. CAS refusal intact, still refusing to overwrite newer state. → existing
   T4310 tests stay green; the new test asserts the stale copy never lands on R2.
3. Written decision on the refused in-flight write (discard, never auto-merge). →
   Decision 2 above.
4. Stated decision on `user.sqlite`. → Decision 4 above + a user.sqlite test case.
