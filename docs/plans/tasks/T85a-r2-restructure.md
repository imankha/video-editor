# T85a: R2 Restructure — Environment + Profiles Path Layout

**Status:** TODO
**Priority:** HIGH - First subtask of T85, before deployment
**Impact:** 8
**Complexity:** 5
**Created:** 2026-02-19
**Parent:** T85 (Multi-Athlete Profiles)
**Depends On:** T80 (Global Game Deduplication)

## Problem

The current R2 bucket (`reel-ballers-users`) has a flat structure with no environment separation and no profile isolation:

```
reel-ballers-users/              (R2 bucket)
  games/                         # Global game storage (T80)
    {blake3_hash}.mp4
  {user_id}/                     # User data at root level
    database.sqlite
    raw_clips/...
    working_videos/...
    final_videos/...
```

This has three issues:
1. **No environment separation** — dev, staging, and prod data would share the same namespace
2. **No profile isolation** — all data for a user is in one flat namespace, making multi-athlete support impossible
3. **No organizational structure** — `games/` and `{user_id}/` sit at the same level with no grouping

## Solution

Restructure R2 paths to add environment prefix, `users/` namespace, and profile-based isolation. Create a default profile for all existing users so the app works identically to today — no UI changes needed.

### Target R2 Structure

```
reel-ballers-users/                          (R2 bucket)
  {env}/                                     (dev | staging | prod)
    games/                                   # Global game storage (unchanged content)
      {blake3_hash}.mp4
    users/
      {user_id}/
        profiles.json                        # Profile name mapping
        selected-profile.json                # Last selected profile GUID
        profiles/
          {profile_guid}/                    # Default profile (auto-created)
            database.sqlite
            raw_clips/...
            working_videos/...
            final_videos/...
```

### profiles.json Format

```json
{
  "default": "a1b2c3d4",
  "profiles": {
    "a1b2c3d4": {
      "name": null
    }
  }
}
```

- `default` — the profile GUID created on first access (never changes)
- `profiles` — map of GUID → metadata. Name is `null` for the initial unnamed profile.

### selected-profile.json Format

```json
{
  "profileId": "a1b2c3d4"
}
```

Separate from `profiles.json` because it changes frequently (on every switch) while `profiles.json` changes rarely (only on create/rename/delete).

### Environment Detection

New env var `APP_ENV` with values: `dev` (default), `staging`, `prod`.

```python
APP_ENV = os.getenv("APP_ENV", "dev")
```

---

## Implementation Plan

### Step 1: Add `APP_ENV` and update `r2_key()` / `r2_global_key()`

The central path change. All R2 paths go through these two functions.

**Current:**
```python
def r2_key(user_id, path):
    return f"{user_id}/{path}"

def r2_global_key(path):
    return f"games/{path}"
```

**New:**
```python
def r2_key(user_id, path):
    profile_id = get_current_profile_id()
    return f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/{path}"

def r2_global_key(path):
    return f"{APP_ENV}/games/{path}"
```

### Step 2: Add profile context

New `ContextVar` for current profile ID (like `_current_user_id`):

```python
# In user_context.py or new profile_context.py
_current_profile_id: ContextVar[str] = ContextVar('current_profile_id', default=None)
```

On request start:
1. Read `selected-profile.json` from R2 (cached in memory after first read)
2. If not found, create default profile with new GUID
3. Set `_current_profile_id`

### Step 3: Update local paths

Local storage mirrors R2 structure:

**Current:** `user_data/{user_id}/database.sqlite`
**New:** `user_data/{user_id}/profiles/{profile_id}/database.sqlite`

Update:
- `get_user_data_path()` → returns `USER_DATA_BASE / user_id / "profiles" / profile_id`
- `get_database_path()` → returns `get_user_data_path() / "database.sqlite"`
- `ensure_directories()` → creates profile subdirectory
- `RAW_CLIPS_PATH`, `WORKING_VIDEOS_PATH`, etc. — these are already derived from `get_user_data_path()`, so they auto-update

### Step 4: Update sync paths

`sync_database_to_r2_with_version()` and `sync_database_from_r2_if_newer()` both use `r2_key(user_id, "database.sqlite")` — they'll automatically use the new path.

### Step 5: Profile initialization (first access)

When a user has no `profiles.json` in R2:
1. Generate a new UUID4 profile GUID
2. Create `profiles.json` with that GUID as default
3. Create `selected-profile.json` pointing to it
4. Upload both to R2
5. Cache in memory

### Step 6: Migration script for user "a" (dev data)

Move existing R2 data from old layout to new layout:

```python
def migrate_user(user_id):
    profile_id = str(uuid4()).replace('-', '')[:8]  # Short GUID

    # 1. Copy database.sqlite
    r2_copy(f"{user_id}/database.sqlite",
            f"dev/users/{user_id}/profiles/{profile_id}/database.sqlite")

    # 2. Copy all files under raw_clips/, working_videos/, final_videos/
    for prefix in ["raw_clips", "working_videos", "final_videos"]:
        for key in r2_list(f"{user_id}/{prefix}/"):
            relative = key[len(f"{user_id}/"):]
            r2_copy(key, f"dev/users/{user_id}/profiles/{profile_id}/{relative}")

    # 3. Create profiles.json
    r2_upload_json(f"dev/users/{user_id}/profiles.json", {
        "default": profile_id,
        "profiles": {profile_id: {"name": None}}
    })

    # 4. Create selected-profile.json
    r2_upload_json(f"dev/users/{user_id}/selected-profile.json", {
        "profileId": profile_id
    })

    # 5. Move games/ to dev/games/
    for key in r2_list("games/"):
        r2_copy(key, f"dev/{key}")
```

Also migrate local `user_data/` directory structure.

### Step 7: Update E2E tests

E2E tests use fresh user IDs. The profile auto-creation (Step 5) handles this — no test changes needed. But verify:
- Fresh E2E user gets default profile created
- All existing test flows work under new paths

---

## Key Files to Modify

| File | Change |
|------|--------|
| `src/backend/app/storage.py` | `r2_key()`, `r2_global_key()` + `APP_ENV` |
| `src/backend/app/database.py` | `get_user_data_path()`, `get_database_path()`, path helpers |
| `src/backend/app/user_context.py` | Add profile context (or new `profile_context.py`) |
| `src/backend/app/middleware/db_sync.py` | Load profile on request start |
| `scripts/migrate_r2.py` | New: migration script |

## Key Files NOT Modified

All routers, services, and frontend code should work unchanged because they use the centralized path functions.

---

## Acceptance Criteria

- [ ] `APP_ENV` env var controls R2 path prefix (defaults to `dev`)
- [ ] `r2_key()` produces `{env}/users/{user_id}/profiles/{profile_id}/{path}`
- [ ] `r2_global_key()` produces `{env}/games/{path}`
- [ ] Fresh user gets default profile auto-created (profiles.json + selected-profile.json)
- [ ] Local paths use `user_data/{user_id}/profiles/{profile_id}/`
- [ ] DB sync works under new paths (version tracking, upload, download)
- [ ] User "a" dev data migrated to new structure
- [ ] All backend tests pass
- [ ] E2E smoke tests pass
- [ ] No UI changes — app behaves identically to before

---

## Risks

1. **R2 migration is one-way** — old paths won't be readable after code change. Need to migrate R2 data BEFORE deploying new code.
2. **Cached paths** — any in-memory path caches need to be invalidated during migration.
3. **presigned URLs** — existing presigned URLs (cached in browser) will break after migration. Users need to refresh.
