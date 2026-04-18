# T1540: Gestures silently lost during game upload

**Status:** TESTING
**Priority:** P0 (data loss)
**Impact:** 9 (silent user data loss — clips added during upload vanish)
**Complexity:** 5
**Created:** 2026-04-16

## Problem

The game record serves two roles that conflict during upload:

1. **FK anchor for clips** — clips need a `game_id` to persist. No game record = no clip saves.
2. **Proof that video bytes exist in R2** — downstream consumers (framing, export, gallery) need the video to be accessible.

These two requirements collide because the game record can't exist before upload (downstream needs bytes) but clips need it to exist immediately (persistence needs FK). Every fix for one side breaks the other:

- **T1180 original (hash→create→upload):** Game exists early, clips can persist — but `_validate_video_in_r2` fails because bytes aren't in R2 yet. Caused gsarah's upload failure (2026-04-16).
- **T1180 fix (hash→upload→create):** Upload completes before game creation, validation passes — but clips added during the upload window (minutes for 3GB files) are silently lost. No `annotateGameId` = no persistence.

The architecture needs to separate these two concerns so they don't keep trading bugs.

### How clip persistence is gated today

All clip persistence in AnnotateContainer flows through `annotateGameId`:
- [AnnotateContainer.jsx:512](src/frontend/src/containers/AnnotateContainer.jsx#L512) — `handleFullscreenCreateClip`: `if (annotateGameId) { saveClip(...) }` — silently skips save when null
- [AnnotateContainer.jsx:554](src/frontend/src/containers/AnnotateContainer.jsx#L554) — `updateClipRegionWithSync`: `if (!annotateGameId) { return; }` — silently skips sync when null

`annotateGameId` is set by the `onGameCreated` callback, which fires only after:
1. File hashing completes
2. Full video upload to R2 completes (can take minutes for 3GB files)
3. `createGame` API call returns

Until step 3 completes, every gesture (add clip, edit clip, rate clip, tag clip) is local-only and lost on navigation.

## Gesture audit

All three editor modes were audited. Framing and Overlay gestures persist correctly because they operate on already-created projects/clips. Only Annotate mode has the gap:

### Annotate mode — affected gestures

| Gesture | Code path | Persists during upload? |
|---------|-----------|------------------------|
| Add clip (fullscreen) | `handleFullscreenCreateClip` L497 | NO — gated on `annotateGameId` |
| Add clip (timeline) | `handleTimelineCreateClip` L618+ | NO — same gate |
| Edit clip (name/rating/tags) | `updateClipRegionWithSync` L542 | NO — early return when no gameId |
| Delete clip | `deleteClipRegion` | NO — backend call needs game context |
| Scrub position (auto-save) | `autoSaveLastPosition` L790 | NO — gated on `annotateGameId` |

### Framing mode — OK

All gestures (crop keyframes, zoom, pan, trim) operate on existing working_clips with known project IDs. Persistence flows through gesture-based action endpoints that don't depend on upload state.

### Overlay mode — OK

All gestures (text overlays, before/after, player tracking) operate on existing working_clips. Same as Framing — no upload dependency.

## Solution: Two-phase game creation (pending → ready)

Separate the game record's two roles with a `status` column:

- **`pending`** — created immediately after hashing. Provides `game_id` as FK anchor for clips. Video bytes may not be in R2 yet. Not visible to downstream consumers (framing, export, gallery).
- **`ready`** — set after upload completes and video is confirmed in R2. Downstream consumers only operate on `ready` games.

### Flow

```
1. Hash file           → create game with status=pending → annotateGameId available
2. Upload to R2        → clips persist normally during this window
3. Upload completes    → flip status to ready
```

### What changes

**Backend:**
- `games` table: add `status TEXT DEFAULT 'ready'` (existing games are all ready)
- `create_game`: accept `status=pending`, skip `_validate_video_in_r2` for pending games
- New endpoint or extend finalize-upload: flip `status` to `ready` after confirming video in R2
- All game-listing queries (framing, export, gallery, admin): filter `status='ready'` by default
- Annotate clip endpoints: allow writes against pending games (they have a valid game_id)

**Frontend:**
- `uploadManager.js`: reorder back to hash→create→upload, but create with `status=pending`. After upload completes, call finalize to flip to `ready`.
- `onGameCreated` fires right after hashing — `annotateGameId` available within seconds
- Upload failure: backend cascade-deletes the pending game + its clips (clean failure)

### Why this is the only option

- **Create early without status (old T1180):** `_validate_video_in_r2` rejects because bytes aren't in R2. Caused gsarah's upload failure.
- **Create late (current):** No `game_id` during upload. Clips silently lost.
- **Client-side queue:** Violates gesture-based persistence. Queue itself lost on navigation.
- **localStorage:** Forbidden by architecture. Same queue problems.

Two-phase creation is the only approach that satisfies both constraints: clips persist immediately (FK exists) and downstream consumers never see a game without valid video bytes (status gate).

## Acceptance criteria

1. User adds clips during upload → clips are saved to backend immediately
2. User navigates away and back during upload → clips are still present
3. Upload failure does not leave orphaned clips (game cleanup cascades)
4. All annotate-mode gestures (add, edit, delete, rate, tag) persist during upload
5. No reactive useEffect persistence introduced

## Related

- T1180 — added `_validate_video_in_r2` to create_game (the validation that currently forces hash→upload→create ordering)
- T1539 — R2 concurrent-write rate limit (clip saves during upload add write volume)
