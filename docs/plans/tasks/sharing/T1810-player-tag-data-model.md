# T1810: Player Tag Data Model & API

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

No data model exists for associating clips with specific athletes. Currently every clip is implicitly "mine." We need a `clip_player_tags` table to track which athletes are featured in each clip.

## Solution

Add `clip_player_tags` table to the per-profile database and backend CRUD endpoints for managing player tags on clips.

## Context

### Relevant Files (REQUIRED)

**Backend:**
- `src/backend/app/database.py` — Add table to schema + migration
- `src/backend/app/routers/clips.py` — Add player tag endpoints, include tags in clip responses
- `src/backend/app/storage.py` — Player tag storage operations

### Related Tasks
- Depends on: T1800 (shared_contacts for autocomplete)
- Blocks: T1820 (UI), T1840 (delivery), T1860 (reel filter)

### Technical Notes

**Table schema (per-profile DB):**
```sql
CREATE TABLE clip_player_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_clip_id INTEGER NOT NULL,
    recipient_email TEXT NOT NULL,
    tagged_at TEXT NOT NULL,
    FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE,
    UNIQUE(raw_clip_id, recipient_email)
);
CREATE INDEX idx_clip_player_tags_clip ON clip_player_tags(raw_clip_id);
CREATE INDEX idx_clip_player_tags_email ON clip_player_tags(recipient_email);
```

**Key design points:**
- Player tags are stored by email only — no profile_id for the recipient (they choose profile on claim)
- The current user's own email is a player tag like any other (auto-added for 4+ star clips)
- Deleting a raw_clip cascades to its player tags
- Tags are per-clip, not per-game (a game may have clips tagged to different players)

**Endpoints:**
- `PUT /api/clips/raw/{id}/player-tags` — body: `{emails: [str]}` — replaces all player tags for clip
- `GET /api/clips/raw/{id}/player-tags` — list player tags for a clip
- Include `player_tags` array in `RawClipResponse` model

**Integration with existing clip save flow:**
- `POST /api/clips/raw/save` could accept optional `player_tags` field
- Or: player tags saved separately after clip creation (simpler, matches gesture-based persistence)

## Implementation

### Steps
1. [ ] Add `clip_player_tags` table to database schema + migration
2. [ ] Storage functions: `set_clip_player_tags(clip_id, emails)`, `get_clip_player_tags(clip_id)`, `get_clips_by_player_tag(email)`
3. [ ] Endpoints: PUT and GET for player tags on clips
4. [ ] Include `player_tags` in RawClipResponse
5. [ ] Backend tests for CRUD + cascade delete

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] `clip_player_tags` table created via migration
- [ ] PUT replaces all player tags for a clip (idempotent)
- [ ] GET returns list of emails tagged on a clip
- [ ] Player tags included in clip list/detail API responses
- [ ] Deleting a clip cascades to its player tags
- [ ] Can query clips by player email (for reel creation filter)
- [ ] Backend tests pass
