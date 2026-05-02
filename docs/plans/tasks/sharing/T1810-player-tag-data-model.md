# T1810: Teammate Annotation Model

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-04-25
**Updated:** 2026-05-02

## Problem

All clips are implicitly "my athlete." Users annotating game footage often clip great plays by teammates but have no way to distinguish these. This distinction is needed for reel creation filtering and as the foundation for the teammate sharing flow (tag-at-framing).

## Solution

Add an `is_teammate` boolean column to `raw_clips` (default 0). Include in clip CRUD API responses and accept in save/update payloads. Support filtering by `is_teammate` in the clip list endpoint.

## Context

### Relevant Files (REQUIRED)

**Backend:**
- `src/backend/app/database.py` — Add column to schema + migration
- `src/backend/app/routers/clips.py` — Include `is_teammate` in clip responses and save/update payloads
- `src/backend/app/storage.py` — Update clip storage operations

### Related Tasks
- Blocks: T1820 (toggle UI), T1840 (tag at framing), T1860 (reel filter)

### Technical Notes

**Schema change (per-profile DB):**
```sql
ALTER TABLE raw_clips ADD COLUMN is_teammate BOOLEAN NOT NULL DEFAULT 0;
```

**API changes:**
- `POST /api/clips/raw/save` — accept optional `is_teammate` field (default false)
- `PUT /api/clips/raw/{id}` — accept `is_teammate` in update payload
- `GET /api/clips/raw` — include `is_teammate` in response, support `?is_teammate=0|1` filter param
- `RawClipResponse` model — add `is_teammate: bool` field

**Design points:**
- Boolean, not enum — "My Athlete" (0) and "Teammate" (1) are the only values
- Default 0 — all existing clips are implicitly "my athlete," no data migration needed
- Set during annotation via toggle (T1820), used for reel filtering (T1860) and as a prompt trigger during framing export (T1840)

## Implementation

### Steps
1. [ ] Add `is_teammate` column to raw_clips schema + migration script
2. [ ] Update storage functions to include is_teammate in CRUD
3. [ ] Update RawClipResponse model
4. [ ] Add `is_teammate` filter param to clip list endpoint
5. [ ] Backend tests for CRUD + filter

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] `is_teammate` column exists on raw_clips (default 0)
- [ ] Clip save/update accepts `is_teammate`
- [ ] Clip list/detail responses include `is_teammate`
- [ ] Clip list endpoint supports `?is_teammate=` filter
- [ ] Existing clips default to `is_teammate = 0`
- [ ] Backend tests pass
