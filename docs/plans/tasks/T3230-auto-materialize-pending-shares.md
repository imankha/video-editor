# T3230: Auto-Materialize Pending Shares on Login

**Status:** TESTING
**Impact:** 9
**Complexity:** 3
**Created:** 2026-05-28
**Updated:** 2026-05-28

## Bug Report: 12p

**Reporter:** 4lgdesigns@gmail.com
**Page:** `/shared/teammate/5c472d85-45e5-44a1-9e0d-e19a2db7637b`
**Build:** 995932b5
**Screenshot:** "Something went wrong. Please try again." with Close button (full dark screen)

### Timeline from console logs

| Time (UTC) | Event | Status |
|------------|-------|--------|
| 21:41:06 | Page loads at share link URL | - |
| 21:41:07 | `GET /api/auth/me` | 401 (not logged in) |
| 21:41:08 | `GET /api/shared/teammate/{token}` | **200 OK** (share metadata loaded) |
| 21:41:08 | `GET /api/quests/definitions` + `/progress` | 200 OK |
| 21:41:08 | FedCM AbortError (Google sign-in noise) | - |
| 21:42:48 | User initiates Google login | - |
| 21:42:53 | `POST /api/auth/google` | **200 OK** (login succeeded) |
| 21:42:54 | **Burst of "Failed to fetch" errors** | ProfileStore, projectsStore, SettingsStore, CacheWarming, gamesDataStore all fail |
| 21:49-21:55 | Long task warnings (CPU-bound, page unresponsive) | - |
| 21:55:15 | Bug reported | Screenshot shows "Something went wrong" |

### What this tells us

1. The recipient **DID click the share link** -- `SharedAnnotationView` loaded and fetched share metadata successfully (200 OK)
2. The auth gate appeared (user wasn't logged in)
3. Google login **succeeded** (200 OK)
4. **Immediately after login**, the auth flow triggered a page reload/navigation that caused all store fetches to fail with "TypeError: Failed to fetch" -- the share context was lost
5. The user never reached the point where `POST /api/clips/resolve-pending-shares` would be called
6. Even after the "Failed to fetch" errors resolved (on retry/refresh), the user landed on the homepage with 0 games because materialization never happened

## Problem

When a user shares clips with a teammate via email, the recipient must navigate the exact share link AND go through the `SharedAnnotationView` component to trigger materialization (`POST /api/clips/resolve-pending-shares`). If the share link context is lost during the Google auth page reload (as happened here), the pending share is never resolved. The recipient sees an empty games list and "Failed to load games" errors.

**Real-world failure (2026-05-28):** imankh@gmail.com shared 3 Nico-tagged clips with 4lgdesigns@gmail.com. The recipient clicked the share link, the share page loaded successfully, but Google auth caused a page transition that lost the share context. `resolve-pending-shares` was never called. Prod Postgres shows `pending_teammate_shares.resolved_at = NULL` and `share_games.materialized_at = NULL`. The recipient's profile SQLite has 0 games.

### Prod data snapshot (2026-05-28)

- **Sharer:** imankh@gmail.com (user_id: `3ed03fb5-949d-4cfd-b708-0c758ea68ef3`)
- **Recipient:** 4lgdesigns@gmail.com (user_id: `51ce372d-7d62-4cde-8596-e25daf72bcf9`, created 21:39 UTC)
- **Share:** Postgres `shares` #10 (type=game, shared_at 20:37 UTC, not revoked)
- **Share games:** game "Vs LA Breakers May 9", tag "Nico", clips ["Lovely Dribble", "Untitled Clip", "Great work"], `materialized_at = NULL`
- **Pending:** `pending_teammate_shares` #3 (share_id=10, `resolved_at = NULL`)
- **Sharer's profile SQLite:** `teammate_emails` maps "Nico" -> "4lgdesigns@gmail.com"; `clip_teammates` has clip_ids [7, 11, 26] tagged "Nico"
- **Recipient's profile SQLite:** 0 games, 0 clips (empty -- nothing was materialized)

## Root Cause

Materialization is ONLY triggered by the frontend calling `POST /api/clips/resolve-pending-shares` from `SharedAnnotationView.jsx`. There is no server-side auto-materialization on login/signup. T2840's task doc mentions "materialization on signup" but it was never implemented in `user_session_init()`.

## Solution

Add auto-materialization of pending shares in `user_session_init()`. When a user's session initializes (first request after login/signup), check if their email has unresolved `pending_teammate_shares`. If yes, and the user has exactly 1 profile, auto-materialize all pending shares into that profile.

This is a backend-only change. The frontend share link flow (`SharedAnnotationView`) continues to work as-is for multi-profile users or as a fallback.

## Context

### Relevant Files

- `src/backend/app/session_init.py` - Main change: add auto-materialization step after profile setup (line ~93)
- `src/backend/app/services/sharing_db.py` - Existing: `get_pending_shares_for_email()` (line 264), `resolve_pending_share()` (line 278), `mark_game_share_materialized()` (line 214)
- `src/backend/app/services/materialization.py` - Existing: `materialize_game_share()` (line 362)
- `src/backend/app/services/auth_db.py` - Existing: `get_user_by_id()` (line 53) returns user dict with `email`
- `src/backend/app/utils/encoding.py` - Existing: `decode_data()` for pending share `clip_data`
- `src/backend/app/services/user_db.py` - Existing: `list_profiles()` or query profiles table for profile count
- `src/backend/app/routers/clips.py` - Reference: `resolve_pending_shares()` endpoint (line 2345) shows the exact materialization pattern to replicate

### Related Tasks

- T2840 (Shared Annotation View) - Mentioned auto-materialization on signup but never implemented it
- T2830 (Game + Annotation Materialization) - Built the materialization infrastructure

### Technical Notes

**Why `user_session_init()` is the right place:**
- Runs once per user per server process (cached in `_init_cache`)
- Already handles new-user setup (profile creation, credit seeding)
- Has access to `user_id` and `profile_id`
- Runs before any API handler, so games will be available on first page load

**Why only auto-materialize for single-profile users:**
- Single profile = no ambiguity about where clips go
- Multi-profile users need to choose which profile receives the clips (existing `SharedAnnotationView` handles this)
- New users always have exactly 1 profile (created moments before in the same function)

**`mark_game_share_materialized()` must also be called** to stamp `share_games.materialized_at` and `recipient_profile_id`. The existing `resolve_pending_shares` endpoint in clips.py does NOT call this (it only calls `resolve_pending_share()` for the pending table). Check if `materialize_game_share()` calls it internally, or if it needs to be called separately.

## Implementation

### Steps

1. [ ] Add auto-materialization block in `user_session_init()` after profile setup (after line 93, before cleanup tasks)
2. [ ] Look up user email via `get_user_by_id(user_id)`
3. [ ] Call `get_pending_shares_for_email(email)` to find unresolved pending shares
4. [ ] Count user profiles - only proceed if exactly 1 profile
5. [ ] For each pending share: decode `clip_data`, call `materialize_game_share()`, call `resolve_pending_share()`, call `mark_game_share_materialized()`
6. [ ] Wrap in try/except so failures don't block login
7. [ ] Add logging for materialization success/failure
8. [ ] Write backend test: create pending share, call `user_session_init()`, verify share is resolved and game exists in profile
9. [ ] Verify on dev: share clips with a test email, sign up as that email, confirm games appear without clicking share link

### Code Pattern (from existing `resolve_pending_shares` endpoint)

```python
# In user_session_init(), after credit seeding (~line 93):

# T3230: Auto-materialize pending teammate shares for single-profile users
try:
    from .services.auth_db import get_user_by_id
    from .services.sharing_db import get_pending_shares_for_email, resolve_pending_share, mark_game_share_materialized
    from .services.materialization import materialize_game_share
    from .utils.encoding import decode_data

    user = get_user_by_id(user_id)
    if user and user["email"]:
        pending = get_pending_shares_for_email(user["email"])
        if pending:
            # Only auto-materialize if user has exactly 1 profile
            from .services.user_db import get_all_profiles
            profiles = get_all_profiles(user_id)
            if len(profiles) == 1:
                for p in pending:
                    try:
                        clip_data = decode_data(p["clip_data"])
                        sharer = get_user_by_id(p["sharer_user_id"])
                        sharer_email = sharer["email"] if sharer else None
                        materialize_game_share(
                            sharer_user_id=p["sharer_user_id"],
                            sharer_profile_id=p["sharer_profile_id"],
                            recipient_user_id=user_id,
                            recipient_profile_id=profile_id,
                            game_id=p["game_id"],
                            tag_name=p["tag_name"],
                            share_id=p["share_id"],
                            clip_data=clip_data,
                            sharer_email=sharer_email,
                        )
                        resolve_pending_share(p["id"], profile_id)
                        mark_game_share_materialized(p["share_id"], profile_id)
                        logger.info(f"T3230: Auto-materialized pending share {p['id']} for user {user_id}")
                    except Exception as e:
                        logger.error(f"T3230: Failed to auto-materialize pending share {p['id']}: {e}")
except Exception as e:
    logger.error(f"T3230: Failed to check pending shares: {e}")
```

### Key Functions Reference

| Function | File | Line | Signature |
|----------|------|------|-----------|
| `get_user_by_id(user_id)` | `services/auth_db.py` | 53 | Returns dict with `email`, `user_id`, etc. |
| `get_pending_shares_for_email(email)` | `services/sharing_db.py` | 264 | Returns list of dicts with `id`, `share_id`, `sharer_user_id`, `sharer_profile_id`, `game_id`, `tag_name`, `clip_data` |
| `resolve_pending_share(pending_id, profile_id)` | `services/sharing_db.py` | 278 | Stamps `resolved_at` + `resolved_profile_id` on `pending_teammate_shares` |
| `mark_game_share_materialized(share_id, profile_id)` | `services/sharing_db.py` | 214 | Stamps `materialized_at` + `recipient_profile_id` on `share_games` |
| `materialize_game_share(...)` | `services/materialization.py` | 362 | Copies game + clips from sharer to recipient profile SQLite |
| `decode_data(raw)` | `utils/encoding.py` | 10 | Decodes msgpack/JSON blob |

### Profile Count Check

Need to verify how to count profiles. Check for `get_all_profiles` or `list_profiles` in `user_db.py`. If neither exists, query the `profiles` table in user.sqlite directly:
```python
conn = get_user_db(user_id)
profiles = conn.execute("SELECT id FROM profiles").fetchall()
```

## Acceptance Criteria

- [ ] New user signs up, has pending shares -> games appear on first page load (no share link click needed)
- [ ] Existing single-profile user logs in with new pending shares -> auto-materialized
- [ ] Multi-profile user logs in with pending shares -> NOT auto-materialized (must use share link flow)
- [ ] Materialization failure does not block login
- [ ] `pending_teammate_shares.resolved_at` is stamped after auto-materialization
- [ ] `share_games.materialized_at` is stamped after auto-materialization
- [ ] Backend test covers the auto-materialization path

## Branch

Use existing branch: `nico_share_bug` (already checked out on master)
