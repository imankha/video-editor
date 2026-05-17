# T2905 Kickoff Prompt: Share Annotated Playback via Link

## Task

Read the task file at `docs/plans/tasks/invite-referral/T2905-share-annotated-playback.md` and the epic context at `docs/plans/tasks/invite-referral/EPIC.md`.

Implement T2905: let users share their annotated playback view with anyone via email link. Recipients see the annotated highlights (reusing the existing SharedAnnotationView) with a signup CTA. This feeds the `annotation_share` channel in the referral graph (T2910, not yet built).

## Classification

```
**Stack Layers:** Frontend + Backend + Database (Postgres migration)
**Files Affected:** ~7 files
**LOC Estimate:** ~200 lines
**Test Scope:** Backend Unit + Frontend Unit

| Agent   | Include? | Justification                                      |
|---------|----------|----------------------------------------------------|
| Code Expert | Yes  | Sharing infra is spread across 4+ services         |
| Architect   | No   | Pattern is well-established from game shares       |
| Tester      | Yes  | New endpoint + new component need coverage          |
| Reviewer    | Yes  | Cross-layer + persistence + Postgres migration      |
| Migration   | Yes  | Adding value to shares CHECK constraint             |
```

## Epic Context

This is task 2 of 3 in the Invite & Referral epic.

**Prior task learnings (T2900):**
- Invite button + referral capture is complete and merged to master
- The invite button now copies a pitch message + referral link to clipboard (was originally mailto:, changed to clipboard during testing because mailto: caused blank tab flash on Windows)
- `?ref=` capture into sessionStorage works on both the app and landing page
- Auth endpoints (Google + OTP) accept an optional `ref` field in the request body
- T2900 did NOT create any DB tables -- invite codes are computed on the fly from SHA-256 of user_id

## Architecture Overview

```
User views Recap in RecapPlayerModal
  -> Clicks "Share" button
  -> SharePlaybackDialog opens (email input + tag selector)
  -> POST /api/games/{game_id}/share-playback { emails, tag_name }
  -> Backend:
     1. Creates shares row (share_type = 'annotation_playback')
     2. Creates share_games row (game_id + tag_name)
     3. Pre-serializes clip data into pending_teammate_shares
     4. Sends email via Resend (fire-and-forget)
  -> Recipient clicks link -> /shared/teammate/{share_token}
  -> Existing SharedAnnotationView renders annotated playback + signup CTA
```

## What to Build

### 1. Postgres Migration: v003

**File:** `src/backend/app/migrations/postgres/v003_annotation_playback_share_type.py`

Add `'annotation_playback'` to the `shares.share_type` CHECK constraint.

**Current constraint** (in `src/backend/app/services/pg.py` line ~100):
```sql
share_type TEXT NOT NULL CHECK (share_type IN ('video', 'game'))
```

**Migration pattern** -- follow `src/backend/app/migrations/postgres/v002_game_ref_counts.py`:
```python
from ..base import BaseMigration

class V003AnnotationPlaybackShareType(BaseMigration):
    version = 3
    description = "Add annotation_playback to shares.share_type CHECK constraint"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_share_type_check")
        cur.execute("""
            ALTER TABLE shares ADD CONSTRAINT shares_share_type_check
            CHECK (share_type IN ('video', 'game', 'annotation_playback'))
        """)
```

Also update `_SCHEMA_DDL` in `pg.py` to include `'annotation_playback'` in the CHECK so fresh installs get the right constraint.

### 2. Backend Endpoint

**File:** `src/backend/app/routers/games.py` (add to existing game router)

**Pattern to follow:** The existing `POST /{game_id:int}/share` endpoint at line ~1512 in `games.py`. T2905's endpoint is nearly identical but:
- Path: `POST /{game_id:int}/share-playback`
- Request body includes `tag_name: str` (athlete name to scope clips)
- Uses `share_type = 'annotation_playback'` (not `'game'`)
- Pre-serializes clip data filtered by `tag_name` for pending shares
- Calls new `send_playback_share_email()` instead of `send_game_share_email()`

**Key functions to reuse from `src/backend/app/services/sharing_db.py`:**
- `create_game_share(game_id, tag_name, sharer_user_id, sharer_profile_id, recipient_email, game_name, game_blake3, first_clip_start, clip_names)` at line ~141 -- creates `shares` + `share_games` rows. **NOTE:** This hardcodes `share_type = 'game'`. You'll need to either add a `share_type` parameter or create a parallel function for annotation_playback shares.
- `create_pending_share(share_id, sharer_user_id, sharer_profile_id, recipient_email, game_id, tag_name, clip_data_bytes)` -- creates `pending_teammate_shares` row
- `get_share_by_token(token)` -- retrieves share record by token

**Key function to reuse from `src/backend/app/services/materialization.py`:**
- `serialize_clip_data(clips)` at line ~429 -- serializes clip list to msgpack bytes for `pending_teammate_shares.clip_data`. Each clip dict has: `rating, tags, name, notes, start_time, end_time, video_sequence`.

**Clip data query:** Query the sharer's user SQLite to get clips for the given `game_id` and `tag_name`:
```python
# Pattern: get clips for a specific tag from sharer's DB
cursor.execute("""
    SELECT * FROM raw_clips
    WHERE game_id = ? AND tags LIKE ?
""", (game_id, f'%"{tag_name}"%'))
```

**Deduplication:** Before creating a share, check if one already exists for the same `(recipient_email, game_id, tag_name)` combination. The `pending_teammate_shares` table has a unique constraint on `(share_id, game_id, tag_name) WHERE resolved_at IS NULL`, but you should also check at the `shares` level to avoid sending duplicate emails.

### 3. Email Template

**File:** `src/backend/app/services/email.py`

Add `send_playback_share_email()` following the pattern of `send_teammate_share_email()` (line ~275) and `send_game_share_email()` (line ~351).

```python
async def send_playback_share_email(
    recipient_email: str,
    sharer_email: str,
    athlete_name: str,
    game_name: str,
    share_token: str,
) -> bool:
```

- Subject: `{sharer_email} shared {athlete_name}'s highlights with you`
- Body: `{sharer_email} shared annotated highlights from {game_name} with you.`
- CTA button: "Watch Highlights" linking to `/shared/teammate/{share_token}`
- Uses `_get_share_url(share_token, share_type="game")` which generates `/shared/teammate/{token}` URLs
- Include CAN-SPAM footer (constant `CAN_SPAM_FOOTER` already defined)
- Fire-and-forget pattern: share is created regardless of email success

### 4. Recipient View: Update GET Endpoint

**File:** `src/backend/app/routers/shares.py` line ~241

The existing `GET /api/shared/teammate/{share_token}` endpoint currently rejects non-game shares:
```python
if share["share_type"] != "game":
    raise HTTPException(404, "Share not found")
```

Update this check to accept both `'game'` and `'annotation_playback'`:
```python
if share["share_type"] not in ("game", "annotation_playback"):
    raise HTTPException(404, "Share not found")
```

No other changes needed -- the response shape is identical since both use `shares` + `share_games` tables. The frontend SharedAnnotationView already handles all the rendering.

### 5. Frontend: Share Button in RecapPlayerModal

**File:** `src/frontend/src/components/RecapPlayerModal.jsx`

Add a share button to the modal header (near the fullscreen toggle / close button). The component already has access to:
- `game.id` -- for the endpoint URL
- `recapData.clips` -- to determine available tags and whether clips exist
- The clips have a `tags` array which contains athlete names

**Behavior:**
- Button visible only when `recapData?.clips?.length > 0`
- Clicking opens `SharePlaybackDialog` modal
- Pass `gameId`, `gameName`, and available `tags` (deduplicated from clips) to the dialog

### 6. Frontend: SharePlaybackDialog Component

**File:** `src/frontend/src/components/SharePlaybackDialog.jsx` (new)

**Follow the pattern of** `src/frontend/src/components/ShareGameModal.jsx` (lines 1-114). Nearly identical structure:

**Props:** `{ gameId, gameName, tags, onClose }`

**Differences from ShareGameModal:**
- Add a tag selector (dropdown or pills) so the user picks which athlete's clips to share
- If only one tag exists, pre-select it and hide the selector
- Endpoint: `POST /api/games/${gameId}/share-playback`
- Request body: `{ emails, tag_name: selectedTag }`
- Toast message: "Highlights shared with N recipient(s)" (not "Game shared")

**Reuse directly:**
- `UserPicker` component (`src/frontend/src/components/shared/UserPicker.jsx`) for email input
- `GET /api/gallery/contacts` for contact autocomplete
- Backdrop click + Escape key dismiss pattern
- `toast` from `./shared/Toast` for success/error feedback

## Existing Code to Read

Before implementing, read these files to understand the patterns:

| File | Why |
|------|-----|
| `src/backend/app/routers/games.py` lines 1508-1643 | POST /share endpoint pattern to follow |
| `src/backend/app/services/sharing_db.py` lines 141-177 | `create_game_share()` function |
| `src/backend/app/services/email.py` lines 275-420 | `send_teammate_share_email()` and `send_game_share_email()` templates |
| `src/backend/app/routers/shares.py` lines 241-289 | GET /shared/teammate/{token} resolver to update |
| `src/backend/app/services/materialization.py` lines 429-442 | `serialize_clip_data()` |
| `src/frontend/src/components/ShareGameModal.jsx` | Dialog template to copy |
| `src/frontend/src/components/RecapPlayerModal.jsx` | Where to add the share button |
| `src/frontend/src/components/SharedAnnotationView.jsx` | Recipient view (no changes needed, just understand it) |
| `src/backend/app/migrations/postgres/v002_game_ref_counts.py` | Migration file pattern |
| `src/backend/app/services/pg.py` lines 96-108 | shares table DDL to update |

## Edge Cases

1. **No clips for game:** Share button hidden/disabled if `recapData?.clips?.length === 0`
2. **Duplicate share (same email + game + tag):** Reuse existing share_token, don't create duplicate rows, don't send duplicate emails
3. **Recipient already has account:** Works through existing materialization flow -- single-profile users get auto-materialized, multi-profile users get a pending share
4. **Multiple tags per game:** Dialog shows tag selector; share is scoped to one tag_name at a time
5. **Email send failure:** Share record is created regardless (fire-and-forget). Failed emails get their share revoked (same pattern as game shares).

## Test Plan

### Backend Unit Tests (`src/backend/tests/test_share_playback.py`)

1. `POST /share-playback` creates `shares` row with `share_type = 'annotation_playback'`
2. `POST /share-playback` creates `share_games` row with correct `game_id` and `tag_name`
3. `POST /share-playback` creates `pending_teammate_shares` row for non-user recipients
4. `POST /share-playback` calls `send_playback_share_email()` with correct params
5. Duplicate share prevention: second POST with same email + game + tag reuses token
6. `POST /share-playback` returns 404 for non-existent game
7. `GET /shared/teammate/{token}` accepts `share_type = 'annotation_playback'`
8. `GET /shared/teammate/{token}` returns tag_name in response

### Frontend Unit Tests (`src/frontend/src/components/SharePlaybackDialog.test.jsx`)

1. SharePlaybackDialog renders email input and tag selector
2. Share button disabled when no emails entered
3. Single-tag games auto-select the tag and hide selector
4. Submit calls `POST /api/games/{id}/share-playback` with correct body
5. Success toast shown on successful share
6. Error toast shown on failure

### RecapPlayerModal Tests

1. Share button visible when clips exist
2. Share button hidden when no clips
3. Clicking share opens SharePlaybackDialog with correct props

## Acceptance Criteria

- [ ] Share button visible on annotated playback view when clips exist
- [ ] Clicking share opens email input dialog
- [ ] Submitting emails creates share records and sends email with playback link
- [ ] Non-user recipient sees annotated playback + signup CTA via shared link
- [ ] Authenticated recipient can materialize shared clips into their account
- [ ] Duplicate shares for same email + game + tag are prevented
