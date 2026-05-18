# Annotation Share: Athletes + Receiver Experience

## Branch

`feature/T2910-referral-graph` (continue on this branch -- changes are additive)

## Overview

Three related improvements to the shared annotation experience for recipients (e.g., a coach receiving clips from multiple players):

1. **Show all athletes on shared clips** -- recipient sees who's in each play
2. **`my_athlete` disabled by default** for received clips -- the clip isn't about the recipient's athlete
3. **Suppress quest dialog and credits** for users who sign up via annotation share links -- they're here to watch, not onboard

---

## 1. Show All Athletes on Shared Clips

### Problem

When a coach receives shared annotation clips, `_insert_clip()` in [materialization.py:226-252](src/backend/app/services/materialization.py#L226) sets `tagged_teammates = NULL`. The coach has no idea which athletes are in each clip. The `shared_by` field only stores the sharer's email, not athlete names.

### Current clip data flow during materialization

1. Sharer's clips have: `tagged_teammates` (msgpack list of athlete names like `["Jake", "Sam"]`), `my_athlete` (1 if clip features their athlete)
2. `_filter_clips_for_tag()` queries sharer's clips filtered by `clip_teammates.tag_name`
3. The `clip_data` passed to `_materialize_clips()` contains: `rating, tags, name, notes, start_time, end_time, video_sequence` -- but **NOT** `tagged_teammates`
4. `_insert_clip()` hardcodes `tagged_teammates = NULL, my_athlete = 1`

### What to change

The recipient's clips should have a `tagged_teammates` list containing all athletes involved in the play:

**Where athletes come from per clip:**
- **Sharer's profile name** (the athlete the sharer manages) -- this is the primary athlete on the clip
- **Original `tagged_teammates`** from the sharer's clip (other players tagged on the play)
- **On merge**: union athlete lists from both the existing clip and incoming clip

**Data flow changes:**

#### A. Include `tagged_teammates` + sharer profile name in clip_data

In [materialization.py](src/backend/app/services/materialization.py), the `_filter_clips_for_tag()` function (around line 190) queries clips but doesn't include `tagged_teammates`. Add it to the SELECT.

The sharer's profile name needs to flow through the materialization chain. `materialize_game_share()` receives `sharer_user_id` and `sharer_profile_id` and already opens the sharer's profile DB (`sharer_conn`). Query the profile name:

```python
# In materialize_game_share(), after opening sharer_conn:
sharer_profile_name = None
if sharer_conn:
    cur = sharer_conn.cursor()
    cur.execute("SELECT name FROM profiles WHERE id = ?", (sharer_profile_id,))
    row = cur.fetchone()
    if row:
        sharer_profile_name = row[0]  # e.g. "Jake Johnson"
```

Pass `sharer_profile_name` down to `_materialize_clips()`.

#### B. Build athlete list in `_insert_clip()`

For each clip being materialized, build the `tagged_teammates` list:

```python
athletes = set()
if sharer_profile_name:
    athletes.add(sharer_profile_name)
clip_teammates = clip.get("tagged_teammates")  # from sharer's clip data
if clip_teammates:
    # clip_teammates is a msgpack-decoded list of names
    athletes.update(clip_teammates)
# Encode as msgpack for storage
tagged_teammates_blob = encode_data(sorted(athletes)) if athletes else None
```

Update the INSERT in `_insert_clip()` to use this blob instead of `NULL`.

#### C. Merge athlete lists on overlap

In `_materialize_clips()` around line 268-289, when merging overlapping clips, union the `tagged_teammates` from both:

```python
if clips_overlap(ex, clip):
    merged_data = merge_clips(ex, clip)
    # Union athlete lists
    existing_athletes = set(decode_data(ex.get("tagged_teammates")) or [])
    incoming_athletes = set(clip.get("tagged_teammates") or [])
    if sharer_profile_name:
        incoming_athletes.add(sharer_profile_name)
    all_athletes = existing_athletes | incoming_athletes
    merged_teammates = encode_data(sorted(all_athletes)) if all_athletes else None
    # Add tagged_teammates to the UPDATE query
```

Also update `_get_existing_clips()` to SELECT `tagged_teammates` so it's available during merge.

#### D. Pending share clip_data

When clips are serialized for `pending_teammate_shares.clip_data` (in [clips.py](src/backend/app/routers/clips.py) around the share-with-teammates endpoint), include `tagged_teammates` in the serialized data. Check `_serialize_clip_data()` or wherever `clip_data` is built before `create_pending_share()`.

Also include the sharer's profile name. The `share-with-teammates` endpoint has access to the sharer's profile. Either:
- Add it as a top-level field on the pending share row (new column), or
- Embed it in each clip dict in `clip_data`, or
- Look it up during resolution from the sharer's profile DB (already opened in `materialize_game_share`)

The third option (look it up during resolution) is simplest and avoids schema changes.

### Key files

| File | Change |
|------|--------|
| [materialization.py:190](src/backend/app/services/materialization.py#L190) | `_filter_clips_for_tag()` -- include `tagged_teammates` in SELECT |
| [materialization.py:210](src/backend/app/services/materialization.py#L210) | `_get_existing_clips()` -- include `tagged_teammates` in SELECT |
| [materialization.py:226](src/backend/app/services/materialization.py#L226) | `_insert_clip()` -- accept + store `tagged_teammates` blob, set `my_athlete=0` |
| [materialization.py:255](src/backend/app/services/materialization.py#L255) | `_materialize_clips()` -- pass sharer_profile_name, union athletes on merge |
| [materialization.py:328](src/backend/app/services/materialization.py#L328) | `materialize_game_share()` -- query sharer profile name, pass it down |
| [clips.py ~2091](src/backend/app/routers/clips.py#L2091) | `share-with-teammates` -- include `tagged_teammates` in serialized clip_data |

---

## 2. `my_athlete` Disabled by Default for Receiver

### Problem

[materialization.py:239](src/backend/app/services/materialization.py#L239) hardcodes `my_athlete = 1` for all materialized clips:

```python
VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)
#                                        ^ always 1
```

This is wrong. The shared clip is about the **sharer's** athlete, not the recipient's. A coach receiving clips from Player A's parent doesn't have "their athlete" in those clips.

### Fix

Change `1` to `0` in `_insert_clip()`:

```python
VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)
#                                        ^ 0 for shared clips
```

This is a one-character change. The `tagged_teammates` NULL will also change as part of fix #1 above.

### Impact on filtering

The annotate screen has a "My Athlete" filter ([ClipDetailsEditor.jsx](src/frontend/src/components/ClipDetailsEditor.jsx)). With `my_athlete=0`, shared clips will be hidden when this filter is active. This is correct behavior -- the coach can toggle the filter off to see all clips, or the filter should default to off when all clips are shared (no `my_athlete=1` clips exist).

Check if the frontend handles the case where ALL clips have `my_athlete=0` gracefully. The filter should either default to "all" or show an empty state with a hint.

---

## 3. Suppress Quest Dialog + Credits for Annotation Share Recipients

### Problem

When a new user signs up via a shared annotation link, they get:
- **8 free credits** auto-granted in `user_session_init()` ([session_init.py:89-92](src/backend/app/routers/session_init.py#L89))
- **Quest panel** rendered as a floating overlay on the annotate screen ([QuestPanel.jsx](src/frontend/src/components/QuestPanel.jsx), rendered in [App.jsx](src/frontend/src/App.jsx))

This doesn't make sense for annotation share recipients. They signed up to watch their kid's clips, not to learn the full product. The quest ("upload a game", "annotate brilliant clips") is irrelevant, and free credits for a feature they may never use is a waste.

### Approach

**Signal the signup context** so both backend and frontend know this user came from a share link.

The share flow already stores `ref` in `sessionStorage` (from T2900). But a share-link signup is distinct from an invite-code signup. The signal needs to differentiate:
- Normal signup (quest + credits)
- Invite-code signup via `?ref=` (quest + credits -- they're a referred user who will use the product)
- Share-link signup (no quest, no credits -- they're here to watch)

**Option A: Frontend-only suppression (simpler)**

The `SharedAnnotationView` component controls the post-auth flow. After auth succeeds and shares resolve, it navigates to the annotate screen. The quest panel could check a flag like `sessionStorage.shared_annotation_flow = true` and hide itself.

For credits: harder to suppress client-side since they're granted server-side in `user_session_init()`.

**Option B: Backend signal on auth (recommended)**

Add a `context` or `signup_source` field to the auth request body (alongside existing `ref`). The `SharedAnnotationView` sets this before triggering auth:

```javascript
// In SharedAnnotationView, before calling requireAuth():
sessionStorage.setItem('signup_source', 'annotation_share');
```

The auth flow passes this to `_find_or_create_user()` and `user_session_init()`:
- `signup_source = 'annotation_share'` -> skip credit grant, set a flag on the user/session
- Frontend reads the flag from `/api/auth/init` response and suppresses quest panel

**Key question for the implementor:** Should the credits/quest be permanently suppressed (this user never gets them), or deferred (they get them when they visit the home screen or upload their own game)? Deferred is probably better -- if they come back and want to use the product, the quest should activate.

### Suggested implementation (deferred approach)

1. **Backend**: In `user_session_init()`, check if the signup came from a share flow. If so, **still grant credits** but add a `signup_source` field to the init response. Don't change the credit logic -- credits are cheap and removing them later is awkward.

2. **Frontend**: In `QuestPanel.jsx`, hide the panel when:
   - `sessionStorage.shared_annotation_flow === 'true'`, OR
   - The user is on the annotate screen viewing a shared game (check if all visible clips have `shared_by` set and `my_athlete=0`)

3. **Frontend**: In `SharedAnnotationView.jsx`, set the session flag before auth:
   ```javascript
   sessionStorage.setItem('shared_annotation_flow', 'true');
   ```

4. **Frontend**: Clear the flag when the user navigates to the home screen or uploads their own game (they're now a "real" user).

### Key files

| File | Change |
|------|--------|
| [SharedAnnotationView.jsx](src/frontend/src/components/SharedAnnotationView.jsx) | Set `sessionStorage.shared_annotation_flow` before auth |
| [QuestPanel.jsx](src/frontend/src/components/QuestPanel.jsx) | Check flag, hide panel during share flow |
| [session_init.py](src/backend/app/routers/session_init.py) | Optionally add `signup_source` to init response |

---

## Testing

### Athletes on shared clips
- Share clips from Player A to Coach -> Coach's clips have `tagged_teammates` including Player A's profile name + any other tagged athletes
- Share from Player B (same game) -> merged clips have athletes from both A and B
- Verify `clip_teammates` junction table is populated for recipient's clips (enables tag-based filtering)

### my_athlete default
- Materialized clips have `my_athlete = 0`
- "My Athlete" filter in annotate screen handles all-zero gracefully (doesn't show empty state with no way to see clips)

### Quest suppression
- Sign up via shared annotation link -> no quest panel on annotate screen
- Navigate to home screen -> quest panel appears (deferred, not suppressed)
- Normal signup (no share link) -> quest panel works as before

### Run existing tests
```bash
cd src/backend && .venv\Scripts\python.exe -m pytest tests/test_materialization.py -v
cd src/backend && .venv\Scripts\python.exe -m pytest tests/test_referrals.py -v
```

Update `test_materialization.py` tests that assert `my_athlete=1` for materialized clips -- they should now expect `0`.

---

## Reference Files

| File | What's There |
|------|-------------|
| [materialization.py](src/backend/app/services/materialization.py) | All materialization logic -- `_insert_clip`, `_materialize_clips`, `merge_clips`, `materialize_game_share` |
| [clips.py:2091-2250](src/backend/app/routers/clips.py#L2091) | `share-with-teammates` endpoint -- builds clip_data for pending shares |
| [clips.py:2336-2412](src/backend/app/routers/clips.py#L2336) | `resolve-pending-shares` -- calls materialize_game_share |
| [ClipDetailsEditor.jsx](src/frontend/src/components/ClipDetailsEditor.jsx) | "My Athlete" toggle + `shared_by` display in UI |
| [SharedAnnotationView.jsx](src/frontend/src/components/SharedAnnotationView.jsx) | Share landing page, auth trigger, pending share resolution |
| [QuestPanel.jsx](src/frontend/src/components/QuestPanel.jsx) | Quest overlay rendering + visibility logic |
| [questStore.js](src/frontend/src/stores/questStore.js) | Quest state management |
| [session_init.py](src/backend/app/routers/session_init.py) | New user session init, credit grant |
| [quest_config.py](src/backend/app/services/quest_config.py) | Quest definitions, `NEW_ACCOUNT_CREDITS = 8` is in `storage_credits.py` |
