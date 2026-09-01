# T8320: Reel Drafts show source-expiry, and reclaimed games stop reporting 'active' (bug 50p follow-up)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-01
**Updated:** 2026-09-01

## Problem

Two gaps found investigating bug 50p, both about expiry being invisible where the user
actually looks:

1. **Reel Drafts are expiry-blind.** All of the app's expiry feedback lives on the Games
   tab ([GameTile.jsx:61-65,324-327](../../src/frontend/src/components/GameTile.jsx): yellow
   countdown chip <14 days, grayscale + "Expired" chip, Extend action). Arshia works from
   Reel Drafts, where a draft whose source game is expired or already reclaimed looks
   identical to a healthy one - `DraftTile.jsx` and `ProjectManager.jsx` contain zero
   storage awareness. He sailed past the 14-day warning window, the expired state, and the
   14-day grace window without ever seeing any of it, and learned the truth from a broken
   player.

2. **`_compute_storage_status(None, falsy)` returns `'active'`** ([games.py:2020-2029](../../src/backend/app/routers/games.py)).
   `delete_ref` DELETES the profile's `game_storage` row at reclaim (auth_db.py:497-518),
   so a reclaimed game has no row -> `expires_at_val=None` -> the function's trailing
   default reports it ACTIVE unless `auto_export_status` happens to be set. Arshia was
   spared only because his games auto-exported. A non-auto-export user would see a
   reclaimed game presented as fine, click in, and hit the broken player on the Games path
   too. This contradicts the T4280 precedent IN THE SAME FUNCTION (unparseable expiry
   deliberately resolves to 'expired' - "the safe direction").

## Solution

1. **DraftTile source-status chip (frontend-only join).** ProjectManager already holds the
   games list (with `storage_status`/`storage_expires_at` per game) and DraftTile already
   receives `project.game_ids` (DraftTile.jsx:241 uses it for upload-pending). Derive per
   draft: any source game expired -> "Source expired" chip (match GameTile's expired chip
   styling); else min days-left among source games < 14 -> countdown chip. No backend
   change, no persisted state (compute on read; no-redundant-state rule).
2. **Safe status default.** In `_compute_storage_status`, when the game HAS a blake3 hash
   but no `game_storage` row: return 'expired' (reclaimed/unknown), keeping 'active' only
   for genuinely storage-less cases (references are already excluded by the caller;
   legacy `video_filename`-only games need a deliberate carve-out - check
   `_game_video_r2_key`'s legacy branch, games.py:2059). Signature likely needs the hash
   (or a `has_hash` flag) passed in; both call sites (list_games ~1122, load_game ~2909)
   updated together so they cannot diverge.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftTile.jsx` - chip render
- `src/frontend/src/components/ProjectManager.jsx` - passes games-by-id storage info to DraftTile
- `src/frontend/src/components/GameTile.jsx` - chip styling to match (324-327)
- `src/backend/app/routers/games.py` - `_compute_storage_status` (2009-2029) + both call sites
- `src/backend/app/services/auth_db.py` - `delete_ref` row-deletion behavior (reference only)
- `src/backend/tests/test_t4820_expired_source_status.py` - extend for the no-row-with-hash case

### Related Tasks
- Sibling: T8310 (reel editor deliberate expired state - the failure moment itself);
  neither depends on the other landing first
- Sibling: T8330 (proactive notification)
- Precedent: T4280 (safe-direction default), T5800 (references have no storage semantics)

### Technical Notes
- Frontend join must handle games the drafts reference that are absent from the games list
  response (deleted game rows): absent game = no chip, not a crash (data-always-ready).
- Watch T8260 (game tile label changes) for merge adjacency on GameTile/ProjectManager.

## Implementation

### Steps
1. [ ] Backend failing test: game with hash + no game_storage row + no auto_export_status
       -> 'expired' from both list_games and load_game; legacy no-hash game stays 'active'
2. [ ] Backend: `_compute_storage_status` signature + both call sites
3. [ ] Frontend unit test: DraftTile renders "Source expired" / countdown chip from games data
4. [ ] Frontend: ProjectManager join + DraftTile chip
5. [ ] Relevant test set + lint; Reviewer on the diff

## Acceptance Criteria

- [ ] A draft whose source game is expired/reclaimed shows a visible chip in Reel Drafts
- [ ] A draft whose source expires within 14 days shows a countdown chip
- [ ] Reclaimed game with no `game_storage` row reports 'expired' regardless of
      auto_export_status; legacy storage-less games unaffected
- [ ] References (T5800) still show no expiry UI anywhere
- [ ] Tests pass
