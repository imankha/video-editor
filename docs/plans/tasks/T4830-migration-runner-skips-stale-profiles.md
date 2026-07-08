# T4830: Migration runner leaves some profiles stuck at old schema versions

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Priority:** P2
**Created:** 2026-07-08
**Discovered by:** T4820 (expired-source repair) — its v023 repair never reached one target game.

## Problem

`run_all_migrations()` reports users as fully migrated, but **some profiles never advance to
the latest schema version** — they stay stuck at old `PRAGMA user_version` values, silently
missing many migrations (not just the one that surfaced this).

Concrete evidence (prod, 2026-07-08, after the T4820 migration ran with `migrated: 8, skipped: 0, errors: 0`):

- User `1b842983-a5ed-4ed3-bbc3-2797f89ec729` has **5 profiles** whose R2 `profile.sqlite`
  `PRAGMA user_version` are: `01ae6a94=3`, `1c844a0b=3`, `7ea71e41=2`, `8a9bd070=6`, `a8428823=6`.
  The profile_db head is **23**. None advanced.
- A **re-run** reported `migrated: 0, skipped: 8` — the runner considers this user already
  current, yet the R2 copies are far behind.
- Consequence for T4820: game 5 (`FRAM`, blake3 `272fad56…`, source 404) lives in profile
  `7ea71e41` (v2). It was **not** repaired by v023 because v023 never ran on that profile.
  The 6 other corrupted games (in migrated profiles) were repaired correctly.

These profiles have therefore missed **every** migration between their stuck version and 23 —
e.g. v012 (inverted-clip range fix), v014 (keyframe dedup), v017–v022 heals, v023. That is a
latent data-integrity problem for any multi-profile user, not just this one.

## Investigation (do this first — root cause is unknown)

Read `src/backend/app/migrations/__init__.py`:
- `_get_profile_ids(user_id)` — lists profiles via R2 `list_objects_v2(Prefix=…/profiles/, Delimiter='/')`
  CommonPrefixes. **Confirmed** it DOES return `7ea71e41` for this user, so the profile is not
  being skipped at enumeration.
- `_migrate_profile_db(user_id, profile_id)` (~L104–129): `db_path = USER_DATA_BASE/…/profile.sqlite`;
  **`if not db_path.exists(): _download_profile_db(...)`** — if a LOCAL copy already exists on the
  prod machine, it is NOT re-downloaded from R2. Then `PROFILE_DB_RUNNER.run(conn)` runs against
  the local copy, and **`if applied: sync_db_to_r2_explicit(...)`** only syncs when something applied.

Prime suspects to confirm/refute:
1. **Stale local copy on the prod machine**: the runner migrates a LOCAL `profile.sqlite` that is
   already at v23 (from serving), applies nothing, and never re-syncs — while the canonical R2 object
   is a different, older copy at v2. (Would mean R2 and the machine-local copy have diverged — itself a bug.)
2. **R2 sync version guard rejects the upload**: `sync_db_to_r2_explicit` / the R2 `x-amz-meta-db-version`
   guard refuses to overwrite when the migrated copy's `db_version` (sync version, independent of
   `user_version`) is not higher — so migrations apply locally but never persist to R2.
3. **Orphan vs live**: are these 5 profiles actually loadable by the app (registered in the user's
   profile registry / `user.sqlite`), or abandoned orphan `profile.sqlite` objects that the app never
   serves? If orphan, user impact is nil and the fix is to stop counting/repairing them (and clean up);
   if live, they serve stale, under-migrated data.

Reproduce by pulling the 5 R2 profile.sqlite for `1b842983` (production/users/…/profiles/*/profile.sqlite),
reading each `PRAGMA user_version`, and tracing one through `_migrate_profile_db` with logging.

## Fix (decide after investigation)

Likely one or more of:
- Make `_migrate_profile_db` operate on the **canonical R2 copy** (always download to a temp path,
  migrate, upload) rather than trusting a possibly-stale machine-local copy; OR
- Fix the sync guard so a schema migration always persists to R2 (bump the sync `db_version` when
  `user_version` advances); OR
- If these are orphan profiles, exclude them from the runner and clean them up (don't leave 404-sourced
  games in dead profiles counted as "active").

Whatever the fix, the runner must **verify** each profile reaches `latest_version` and **fail loudly**
(count as an error, not "migrated") when a profile it enumerated did not actually advance — the current
silent "migrated: 8" while profiles stay at v2 is the core reporting bug.

## Acceptance criteria

- [ ] Root cause identified with evidence (which of suspects 1/2/3, traced on real data).
- [ ] After a migration run, every enumerated profile is at `latest_version` in **R2** (verify by
      re-downloading), or is explicitly excluded (orphan) with a logged reason.
- [ ] `run_all_migrations` no longer reports a profile as migrated when its R2 copy did not advance —
      such cases surface in `errors`.
- [ ] `1b842983` profiles either advance to 23 (and game 5 repairs via v023 → computes 'expired'),
      or are confirmed orphan and cleaned up.
- [ ] Backfill/verify pass across all prod multi-profile users for stuck profiles.

## Context / relevant files

- `src/backend/app/migrations/__init__.py` — `run_all_migrations`, `_migrate_user`, `_migrate_profile_db`,
  `_get_profile_ids`, `_download_profile_db`.
- R2 sync + version guard: `src/backend/app/database.py` (`sync_db_to_r2_explicit`) and the
  `x-amz-meta-db-version` logic in `src/backend/app/storage.py`.
- Profile registry (to decide orphan vs live): `src/backend/app/services/user_db.py`.

See [[project_bug29p_v017_resurrection]] for the T4820 trail that surfaced this. Source-existence
check pattern (s3v4 + region='auto', else R2 returns 400 not 404) reused from that investigation.
