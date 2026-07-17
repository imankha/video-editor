# T5310: Registry <-> R2 profile mismatch on prod (missing + orphan profiles)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-17

## Problem

The 2026-07-17 prod `run_all_migrations()` pass (run before the T4950 poster force-regen)
surfaced three profiles where the **profile registry** (the `profiles` table in a user's
`user.sqlite`) and the **R2 profile directories** disagree. The migration itself did not fail on
these — the runner reports them and moves on (this is exactly the `errors[]`/`orphans[]`
reporting T4830 added) — but each represents a data-integrity crack worth root-causing so we know
whether any real user data was lost or is unreachable.

There are TWO opposite mismatch directions here, and they are NOT the same bug:

### Direction A — "missing": registry HAS the profile, R2 has NO `profile.sqlite`
`_migrate_profile_db` force-downloads the canonical R2 copy; `_download_profile_db` returned
`found=False` (the key `production/users/{uid}/profiles/{pid}/profile.sqlite` does not exist),
so the runner recorded `reason: "missing"`. The registry (`get_profiles`, reading the `profiles`
table in `user.sqlite`) lists these profiles as real, but R2 has nothing for them.

- **user_id** `937e5e54-d49a-4ebb-8b54-fdd878e15df9` (**arshia.kalantari@gmail.com**)
  - profile `22c7616a` — `missing`, `r2_version: null`
  - profile `6ff007e6` — `missing`, `r2_version: null`

This is the more concerning direction: a registered profile with no R2 object is either (a) a
profile row that was created in `user.sqlite` but whose first `profile.sqlite` upload never
happened / failed silently, or (b) a profile whose R2 object was deleted/never-synced while the
registry row survived. Either way the app would try to load a profile that has no backing data.

### Direction B — "orphan": R2 HAS a profile dir, registry does NOT list it
`_get_profile_ids` lists `production/users/{uid}/profiles/` CommonPrefixes in R2 and finds a
directory the registry doesn't know about. The runner logs + reports it and NEVER migrates it
(registry is authoritative — T4830 behavior).

- **user_id** `3ed03fb5-949d-4cfd-b708-0c758ea68ef3` (**imankh@gmail.com**)
  - profile `b95eb93b` — orphan (R2 dir exists, not in registry)

This orphan is **already known**: it's named in the `poster-backfill-orphan-gotcha` memory as one
of the two prod orphans at 2026-07-13 (both 0 published reels), and T5110 had to
`_migrate_profile_db` it by hand before the poster backfill would run. So Direction B is the
T4830/T5110 orphan class we've seen before; it's captured here only to have both directions in
one place. T4830 proposed an opt-in, archive-not-delete orphan cleanup script that was never run
on prod.

## Why this matters (infra depth)

Depth 1-2 (schema/data integrity + sync/persistence). A registry that disagrees with R2 silently
corrupts everything above it: migrations skip/error on these profiles, the poster backfill
crashes on below-head orphans (T5110), and a "missing" registered profile could present the user
an empty/broken profile. This is not user-facing today (arshia's two profiles were not blocking
the migration or the poster regen), which is exactly why it should be root-caused deliberately
rather than waiting for it to surface as a support ticket.

## Investigation plan (root-cause, do NOT blindly repair)

1. **Direction A (arshia, missing):** For each of `22c7616a` / `6ff007e6`:
   - Read arshia's `user.sqlite` `profiles` table (via `get_profiles` / a proxy + admin read):
     when were the rows created (`created_at`), are they the default, do they have games/reels
     referenced anywhere?
   - List `production/users/937e5e54-.../profiles/` in R2 directly — confirm the two dirs truly
     have no `profile.sqlite` (vs. an unexpected key layout). Check R2 object versioning /
     deletion markers if enabled.
   - Determine the origin: was a profile row written to `user.sqlite` without a matching first
     R2 upload (create-without-sync)? Cross-check the profile-create code path
     (`user_db.py` create + the first `sync_db_to_r2_explicit`). This is the likely root cause
     and the one worth fixing — a profile must not be registered until its R2 object exists.
2. **Direction B (imankh orphan `b95eb93b`):** confirm it's still the same known 0-reel orphan
   from 2026-07-13; decide whether the T4830 archive-not-delete cleanup should finally run on
   prod, or whether it should be re-adopted into the registry.
3. **Systemic:** count how many prod users have EITHER direction of mismatch (extend the one-off
   scan across all users, not just these two accounts) so we know the true blast radius before
   choosing a fix.

## Related work (read before starting)

- **T4830** (DONE) — migration runner registry-join + `errors[]`/`orphans[]` reporting; this is
  the machinery that surfaced these. It treated orphans as "no impact"; Direction A ("missing")
  was not in scope.
- **T5110** (DONE) — poster backfill crashes on below-head orphans; manual unblock =
  `_migrate_profile_db` each orphan first. The enumeration mismatch between `_get_profile_ids`
  (includes orphans) and `run_all_migrations` (registry-filtered) is the same fault line.
- **T4820** (DONE) — expired-source status corruption; noted a separate profile stuck at old
  schema in an old profile, same family of registry/sync anomalies.
- Memory: `poster-backfill-orphan-gotcha` (names `b95eb93b`), `reference_running_migrations`,
  `reference_migration_runner_rowfactory`.

## Relevant files
- `src/backend/app/migrations/__init__.py` — `_migrate_user` (registry join, orphan detection,
  missing/error reporting), `_get_profile_ids` (R2 listing), `_download_profile_db`,
  `_migrate_profile_db`.
- `src/backend/app/services/user_db.py` — `get_profiles` (the authoritative registry read),
  profile create path.
- `scripts/edit-user-db.py` / a read-only admin path — for inspecting arshia's `profiles` table.

## INVESTIGATION FINDINGS (2026-07-17, supervisor-run read-only prod diagnostic)

Read-only prod scan (`fly ssh` + `get_all_users_for_admin` + `get_profiles` registry read +
R2 `head_object` per profile). No writes.

### Blast radius (full fleet, 9 prod users)
- **7 clean.**
- **Direction A "missing" — 1 user, 2 profiles:** arshia.kalantari@gmail.com (937e5e54):
  `6ff007e6` ("Ella U13") + `22c7616a` ("Ella 12U") — registry rows exist, no R2 profile.sqlite.
- **Direction B "orphan" — 1 user, 1 profile:** imankh@gmail.com (3ed03fb5) `b95eb93b` — the
  known 0-reel orphan (poster-backfill-orphan-gotcha memory). Confirmed still orphan.
- So the mismatch is NOT widespread; it's the two accounts the migration already named.

### Root cause of Direction A (create-without-durable-sync) — HIGH confidence
arshia's profiles were created in rapid PAIRS, and in each pair the SECOND profile is the missing one:
| created_at | profile | R2 profile.sqlite |
|---|---|---|
| 2026-07-10 01:10:23 | b0a81fe1 "Maddie U13" | ✅ present |
| 2026-07-10 01:10:35 (+12s) | **6ff007e6 "Ella U13"** | ❌ MISSING |
| 2026-07-11 03:37:49 | 7d9f31c7 "Maddie 12U" | ✅ present |
| 2026-07-11 03:38:04 (+15s) | **22c7616a "Ella 12U"** | ❌ MISSING |

The `POST /api/profiles` handler ([profiles.py:98-127](../../src/backend/app/routers/profiles.py#L98))
does: `db_create_profile` (writes the registry row to user.sqlite) → `set_selected_profile_id`
→ `ensure_database()` (creates profile.sqlite **locally only**) → return. **There is NO explicit
durable R2 sync of the new profile.sqlite before returning** — it relies on the middleware's
fire-and-forget background sync (db_sync.py, 0.5s lock timeout → `.sync_pending`). The user.sqlite
registry (one file, synced on many later requests) reliably reaches R2 with BOTH rows; but each
new profile.sqlite is a SEPARATE R2 object whose only sync is the fire-and-forget one. When a
second profile is created seconds after the first, that second profile.sqlite's sync loses the
lock / is coalesced / the machine cycles before it completes → registered profile, no R2 object.

**This is a specific instance of the [T4320] durability gap** (a create that returned success does
not survive a machine cycle because it rode fire-and-forget sync). Same class, different gesture.

### Fix-at-source recommendation
`create_profile` must **durably** sync the new profile.sqlite (and the user.sqlite registry) to
R2 BEFORE returning — an explicit `sync_db_to_r2_explicit` on the new profile, or `Depends(durable_sync)`
— so a profile is never REGISTERED without its R2 object existing. Fold into T4320's durable-sync
work (same mechanism) rather than a bespoke fix.

### Data-loss assessment + repair
The 2 arshia profiles most likely were created-then-abandoned (she used the "Maddie" of each pair).
Any data added while on Ella's profiles would have died with the ephemeral machine (never synced) —
but there's no evidence she added any. Repair options: (a) create empty profile.sqlite R2 objects for
`6ff007e6`/`22c7616a` so the registry pointers resolve (preserves her intent; she re-adds data), or
(b) remove the 2 dangling registry rows. Prefer (a). NEEDS a user decision before touching prod data.

### Discrepancy to note (care)
A first per-account probe returned b95eb93b inside arshia's registry+R2 list, while the systematic
fleet scan attributes b95eb93b to imankh (orphan). The fleet scan (per-user, context-reset) is the
trustworthy one; the first probe likely hit a `get_profiles`/`_get_profile_ids` ContextVar/caching
artifact when called repeatedly. Worth care if anyone re-runs a per-account read.

### Direction B disposition
imankh `b95eb93b`: known 0-reel orphan; recommend the T4830 archive-not-delete cleanup (never run
on prod) OR leave benign-and-documented. No data at risk (0 reels).

### REPAIR APPLIED (2026-07-17, user-approved)
Recreated empty head-schema profile.sqlite R2 objects for arshia's 2 missing profiles
(`ensure_database()` in each profile context → `sync_db_to_r2_explicit`; guarded to skip if
present). Both `CREATED+SYNCED` at `user_version=25` (head). Re-scan confirms **arshia clean,
`missing_A: []`, 8/9 users clean**. Her next session downloads them from R2 as empty profiles
(intent preserved; she re-adds data). No user.sqlite/registry change; non-destructive.

**Still OWED (code, not done here):**
- **Source fix** — `create_profile` must durably sync the new profile.sqlite before returning
  (folds into [T4320]); until then the create-without-durable-sync race can recur for a rapidly
  created second profile.
- **Direction B** — imankh orphan `b95eb93b` disposition (T4830 archive-cleanup or leave benign).

## Acceptance criteria
- [ ] Root cause identified for Direction A: WHY do `22c7616a` / `6ff007e6` exist in arshia's
      registry with no R2 `profile.sqlite` (create-without-sync vs. deleted-object vs. other),
      backed by reading both the registry rows and the R2 state directly.
- [ ] Blast-radius count: how many prod users have a "missing" registered profile and how many
      have an orphan (full-fleet scan, not just these two accounts).
- [ ] A decision recorded for each direction: fix-at-source (e.g. never register a profile before
      its R2 object exists) and/or a one-off repair, vs. accept + document. No silent read-time
      fallback (project rule) — repair the data or fix the source, don't paper over it.
- [ ] imankh orphan `b95eb93b` dispositioned (cleanup-archive per T4830, re-adopt, or confirm
      benign-and-leave with a reason).
