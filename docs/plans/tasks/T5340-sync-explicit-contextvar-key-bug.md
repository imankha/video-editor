# T5340: `sync_db_to_r2_explicit` uses the ContextVar for the R2 key (corrupts cross-profile syncs)

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-17
**Epic:** durability-sync campaign (data-integrity)

## Problem

`sync_db_to_r2_explicit(user_id, profile_id)`
([database.py:1221](../../src/backend/app/database.py#L1221)) is documented "**without relying on
ContextVars** … designed for background workers where ContextVars are no longer valid." **That
docstring is false.** It uses the `profile_id` ARG for the LOCAL file path
(`get_user_data_path_explicit(user_id, profile_id)`, :1243) but the R2 upload KEY comes from
`sync_database_to_r2_with_version` → `r2_key(user_id, "profile.sqlite")`
([storage.py:1030](../../src/backend/app/storage.py#L1030) → [storage.py:266](../../src/backend/app/storage.py#L266)),
and `r2_key` derives the `{profile_id}` segment from **`get_current_profile_id()` (the ContextVar)**,
not the arg:

```
{APP_ENV}/users/{user_id}/profiles/{get_current_profile_id()}/profile.sqlite
```

So when the arg and the ContextVar disagree, the function reads the RIGHT local DB and writes it to
the WRONG R2 key.

## Confirmed live impact — T4850 "Transfer Reels Between Profiles" (DONE, deployed prod 2026-07-13)

`move_reels_to_profile` ([downloads.py:1116-1117](../../src/backend/app/routers/downloads.py#L1116))
calls `sync_db_to_r2_explicit(user_id, target_profile_id)` **without setting the ContextVar to the
target** (it trusts the "explicit" docstring). During the request the ContextVar is the user's
ACTIVE (source) profile. Result: the target profile's updated profile.sqlite (with the just-inserted
moved reels) is uploaded to the **SOURCE** profile's R2 key →
- the **source** profile's durable R2 copy is overwritten with the target's DB (corruption), and
- the **target** profile's R2 copy never receives the moved reels (the move looks lost after a
  machine cycle / on another device).

Found independently by the T4320 implementor AND its fresh-context reviewer. Confirmed by reading
`r2_key` (uses the ContextVar) — not a false positive.

## Root cause + fix (fix the primitive, not just the caller)

The bug is in `sync_db_to_r2_explicit` itself — a function whose entire purpose is ContextVar
independence must not route its R2 key through a ContextVar. Fix at the primitive so EVERY caller is
protected:
- Add a profile-explicit key path: `r2_key_explicit(user_id, profile_id, path)` (or a
  `profile_id`-parameterized variant of `sync_database_to_r2_with_version`) and use it in
  `sync_db_to_r2_explicit`, so the R2 key uses the ARG, never the ContextVar.
- Audit ALL callers of `sync_db_to_r2_explicit` (export_worker, T4320's new durable-sync sites,
  move-reels, migrations) — they've been correct only where the ContextVar happened to match the
  arg. After the fix, correctness no longer depends on that coincidence.
- No silent fallback: if the arg is required and absent, raise (don't fall back to the ContextVar).

## Data-repair question (investigate before assuming loss)
Determine whether any prod profile-to-profile move actually corrupted R2 (T4850 was user-tested on
dev — maybe the tested path had the ContextVar set to target by luck, or maybe dev data is already
affected). Scan for source profiles whose R2 profile.sqlite unexpectedly contains another profile's
reels. Repair from a pre-move R2 snapshot if found. Do NOT assume clean; do NOT assume loss.

## PROD SCAN RESULT (2026-07-17, supervisor-run, read-only)
HEAD-only scan of every prod user with >=2 profiles for the corruption signature (two sibling
`profile.sqlite` objects sharing identical content = one overwrote the other). **No corruption
found.** The only ETag collision was arshia's `22c7616a` + `6ff007e6` — the two EMPTY profiles the
T5310 repair recreated (both `db-version=1`, 237568 bytes = identical empty head-schema DBs, identical
by construction), NOT move-reels corruption. Every other profile has a distinct ETag. Conclusion: the
move-reels wrong-key write either was never triggered on prod (niche multi-athlete feature) or the
end-of-request `durable_sync` re-synced the correct source DB over the transient bad write. **No prod
data repair needed** — the code fix (this task) prevents recurrence.

## Relevant files
- `src/backend/app/database.py` — `sync_db_to_r2_explicit` (:1221), `sync_user_db_to_r2_explicit` (check the user.sqlite analog for the same trap)
- `src/backend/app/storage.py` — `sync_database_to_r2_with_version` (:957), `r2_key` (:266)
- `src/backend/app/routers/downloads.py` — `move_reels_to_profile` (:942, sync at :1116)
- callers of `sync_db_to_r2_explicit` across export_worker + T4320 sites

## Acceptance Criteria
- [ ] `sync_db_to_r2_explicit` (and the user.sqlite analog) write to the R2 key derived from the
      `profile_id`/`user_id` ARGS, never the ContextVar; docstring becomes true.
- [ ] A test proves: with the ContextVar set to profile A, `sync_db_to_r2_explicit(user, B)` uploads
      to B's R2 key (not A's).
- [ ] T4850 move-reels verified end-to-end: after a move, the TARGET R2 copy has the moved reels and
      the SOURCE R2 copy is unchanged (seam or real-R2 test).
- [ ] Prod scan for existing cross-profile corruption; repair decision recorded.
- [ ] No silent fallback introduced.

## Classification hint
M/L-tier, backend-only + a prod data scan. Data-integrity depth (1-2). Part of the durability
campaign. Related: T4320 (surfaced it), T4310 (CAS — the ContextVar-vs-arg key hazard is the same
family), T4850 (the affected feature).
