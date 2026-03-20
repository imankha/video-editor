# T410: Migrate Guest Progress on Login

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-03-19
**Updated:** 2026-03-19

## Problem

When a guest user makes progress (uploads games, creates projects) and then logs in with Google, cross-device recovery switches them to their existing user_id. The guest's progress is orphaned under the old guest user_id and effectively lost.

Currently, the guest data sits in a separate user folder that nobody can access after login.

## Solution

During Google OAuth login, when cross-device recovery activates (existing email found), check if the guest had any real progress. If so, migrate the guest's profile as a new named profile ("second") on the recovered account. If the guest had no games, skip migration — no point creating an empty profile.

### Rules

1. **Only migrate if guest has games** — no games means no meaningful progress worth preserving
2. **Name the migrated profile "second"** — only the original profile should be unnamed/default
3. **Don't create empty profiles** — if no progress, just switch cleanly to the existing account
4. **Guest data stays intact** — copy/link, don't move, so rollback is possible

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` - Google OAuth endpoint (cross-device recovery logic)
- `src/backend/app/session_init.py` - Profile initialization
- `src/backend/app/storage.py` - R2 profile read/write, `R2ReadError`
- `src/backend/app/routers/profiles.py` - Profile CRUD (reference for how profiles are created)
- `src/backend/app/services/auth_db.py` - User lookup functions

### Related Tasks
- Depends on: T405 (central auth DB — DONE)
- Related: T85b (profile switching — DONE)

### Technical Notes

**Discovery context:** This was discovered when a Google login triggered cross-device recovery but `read_selected_profile_from_r2` failed (R2 returned 404 via HeadObject instead of NoSuchKey). `user_session_init` treated the error as "new user" and created a fresh empty profile, overwriting the user's real profile selection. The R2ReadError fix (separate commit) prevents the data loss, but the guest progress migration feature would make the cross-device recovery experience seamless.

**Flow:**
1. Guest browses, uploads games, creates clips/projects under guest user_id
2. Guest clicks "Sign In" with Google
3. Backend finds existing email in auth DB → cross-device recovery
4. **NEW:** Before switching user_id, check guest's profile for games
5. If games exist: copy guest profile into recovered account as profile named "second"
6. If no games: just switch cleanly (current behavior)

**Key consideration:** The guest's profile database lives under `user_data/{guest_user_id}/profiles/{profile_id}/database.sqlite`. Migration needs to copy this DB (and any R2 data) to `user_data/{recovered_user_id}/profiles/{new_profile_id}/`.

## Implementation

### Steps
1. [ ] In Google auth handler, after cross-device recovery resolves user_id, check if guest had games
2. [ ] Query guest's active profile database for `SELECT COUNT(*) FROM games`
3. [ ] If games > 0: create new profile on recovered account named "second"
4. [ ] Copy guest profile database to new profile path (local + R2)
5. [ ] Update recovered account's profiles.json to include new profile
6. [ ] Keep selected profile pointing to original (don't auto-switch)

## Acceptance Criteria

- [ ] Guest with games → logs in → sees original data + "second" profile with guest data
- [ ] Guest without games → logs in → only sees original profile, no "second" created
- [ ] Original/default profile remains selected after login
- [ ] Profile names are distinct: original is unnamed/default, migrated is "second"
