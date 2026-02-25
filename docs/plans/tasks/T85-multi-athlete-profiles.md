# T85: Multi-Athlete Profiles

**Status:** TODO
**Priority:** HIGH - Before deployment
**Impact:** 7
**Complexity:** 6
**Created:** 2026-02-13
**Updated:** 2026-02-19
**Depends On:** T80 (Global Game Deduplication)

## Problem

Users may create highlights for multiple athletes (coaching a team, parent with multiple kids). Currently everything is in one database with no separation. Also, R2 has no environment separation (dev/staging/prod share the same namespace).

## Solution

Split into two subtasks:

| Subtask | What | UI Changes |
|---------|------|------------|
| **T85a** | R2 restructure: add `{env}/users/` prefix, profile GUID folders, default profile | None — app works identically |
| **T85b** | Profile CRUD API, frontend switcher, management modal | Full UI |

### Design Decisions (Updated 2026-02-19)

**Simplified from original plan:**
- **No second SQLite database** — profile metadata stored in `profiles.json` (not a separate `user.sqlite`)
- **No `X-Athlete-ID` header** — profile ID derived from `selected-profile.json`, cached in memory
- **Environment prefix** — `{env}/` at R2 root separates dev/staging/prod data
- **`users/` namespace** — groups user data separately from `games/`

### R2 Structure

```
reel-ballers-users/                          (R2 bucket)
  {env}/                                     (dev | staging | prod)
    games/
      {blake3_hash}.mp4
    users/
      {user_id}/
        profiles.json                        # GUID → name mapping
        selected-profile.json                # Last selected profile
        profiles/
          {profile_guid}/
            database.sqlite
            raw_clips/...
            working_videos/...
            final_videos/...
```

## Subtasks

| ID | Task | Status | Complexity |
|----|------|--------|------------|
| T85a | [R2 Restructure](T85a-r2-restructure.md) | TODO | 5 |
| T85b | [Profile Switching](T85b-profile-switching.md) | TODO | 6 |

**T85a must be completed before T85b.** T85a is purely structural (path changes + migration), T85b adds the multi-profile UX.

## Acceptance Criteria

- [ ] T85a: R2 paths include environment and profile, default profile works transparently
- [ ] T85b: Users can create, switch, rename, and delete profiles
- [ ] Games are shared across profiles (via T80 global storage)
- [ ] All existing functionality works under new structure
