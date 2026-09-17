# T10300: Link a directly uploaded clip to a game later, and say so in the upload notice

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17: "When users upload clips directly, they should be able to associate that clip
with a game later (at any time). Once this is the case we should update this dialog to let the
user know they should link it to a game." The dialog is `ClipUploadNoticeModal.jsx`
(`CLIP_UPLOAD.NOTICE_TITLE/BODY` in `displayNames.js:198-207`): "Heads up: these clips won't be
linked to a game ... they won't be part of a game you can build more highlights from."

Today (trace 2026-09-17): a direct upload is inserted with `raw_clips.game_id = NULL`
(`clips.py:2059-2063`), `game_id` is nullable with `ON DELETE CASCADE` (`database.py:1188,1205`),
and **`game_id IS NULL` is the idempotency discriminator** for uploaded clips (`clips.py:1957-1960`).
Nothing in the frontend or the clip routers ever sets `game_id` on an existing clip; the only
editable fields are name/rating/tags/notes. Projects expose a derived `game_ids[]` that filters
`rc.game_id IS NOT NULL` (`collection_metadata.py:87-106`), so linking would automatically make
the clip's project show under that game.

## Solution

Architect gate (new gesture on a data invariant). Questions the design must settle:
- A linked uploaded clip has no `start_time`/`end_time` inside the game's timeline (its bytes are
  its own `raw_clips/` source, not a cut of the game video). Linking must therefore mean
  **attribution** (shows under the game in Clips/Published, counts toward the game's clip count,
  inherits opponent/date for titles) and NOT a fake segment on the game timeline. Decide how
  `game_id != NULL` + no timeline position is represented without breaking the game-cut natural
  key (`game_id + end_time + video_sequence`, `clips.py:1238-1248`) and the idempotency check.
- The idempotency check for re-uploads (`filename AND game_id IS NULL`) must still find a clip
  that has since been linked (use `source = 'upload'` or `blake3_hash`, not `game_id IS NULL`).
- Cascade: `ON DELETE CASCADE` on `game_id` would DELETE the uploaded clip when the game is
  deleted; for an attributed-only link that is wrong. Use `ON DELETE SET NULL` for upload-sourced
  clips (schema migration, profile_db track) or unlink on game delete explicitly.

UI: a "Link to game" action on the uploaded clip's tile/menu (Clips tab) and in the editor
header, opening a game picker (existing games list); gesture -> `POST /api/clips/{id}/actions`
with `{ set_game_id }` (surgical). Notice copy becomes: "Heads up: these clips start out unlinked
from a game. Uploading here adds videos straight to your clips, ready for Framing and publish.
You can link a clip to a game at any time from the Clips tab so it shows up with that game's
highlights." (through `displayNames.js`).

## Context

### Relevant Files
- `src/backend/app/routers/clips.py:139-203,1230-1248,1908-2105`, `src/backend/app/database.py:1178-1208`
- `src/backend/app/services/collection_metadata.py:87-106`
- `src/frontend/src/components/ClipUploadNoticeModal.jsx`, `DraftTile.jsx:184`,
  `ProjectManager.jsx:545-570,2192-2196`, `config/displayNames.js:198-207`
- Migration: `src/backend/app/migrations/profile_db/` (FK change), Migration agent

### Related Tasks
- Depends on: T10250/T10260 landing first (upload path stable). Independent of the tutorial.

## Acceptance Criteria

- [ ] An uploaded clip can be linked to any of the profile's games at any time, and unlinked
- [ ] Linked clip appears under that game in Clips/Published; game delete does not delete it
- [ ] Re-uploading the same file after linking is still idempotent
- [ ] Notice copy updated; tests for the action + migration
