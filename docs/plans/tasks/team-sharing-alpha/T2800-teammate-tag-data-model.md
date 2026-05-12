# T2800: Teammate Tag Data Model

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** None (foundation task)
**Supersedes:** T1810 (Teammate Annotation Model)

## Problem

Users need to tag teammates by name during annotation so clips can later be shared with the right recipients. The original T1810 design used a simple `is_teammate` boolean -- this design uses named tags and a tag-to-email mapping for targeted sharing.

## Solution

### 1. Schema Changes to `raw_clips` (profile SQLite)

Add two columns:

```sql
ALTER TABLE raw_clips ADD COLUMN tagged_teammates TEXT DEFAULT NULL;
-- JSON array of tag name strings, e.g. '["Jake", "Player 7"]'
-- NULL = no teammates tagged (most clips)

ALTER TABLE raw_clips ADD COLUMN my_athlete INTEGER DEFAULT 1;
-- 1 = my athlete is in this clip (default)
-- 0 = teammate-only clip
```

### 2. New Table: `teammate_emails` (profile SQLite)

Stores the tag name to email address mapping per profile. Multiple emails per tag supported.

```sql
CREATE TABLE teammate_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tag_name, email)
);

CREATE INDEX idx_teammate_emails_tag ON teammate_emails(tag_name);
```

### 3. API Changes

**Clip save/update** -- accept new fields:
- `tagged_teammates`: array of strings (tag names)
- `my_athlete`: boolean (default true)

Both sent as part of existing clip save gesture (no new endpoints for clip persistence).

**New endpoints:**

```
GET /api/profiles/{profile_id}/teammate-tags
```
Returns distinct tag names used in this profile's raw_clips, ordered by frequency. For annotation autocomplete.

```
GET /api/profiles/{profile_id}/teammate-emails
```
Returns all tag_name -> email mappings. For share flow autocomplete.

```
PUT /api/profiles/{profile_id}/teammate-emails
```
Upsert tag_name -> email mappings. Accepts array of `{tag_name, email}` pairs. Called from the share flow when user maps tags to emails.

```
DELETE /api/profiles/{profile_id}/teammate-emails/{id}
```
Remove a specific mapping.

## Migration

- Schema migration adds columns + creates table
- No data migration needed (new columns have safe defaults)
- `tagged_teammates` defaults to NULL, `my_athlete` defaults to 1

## Test Scope

- Backend unit tests for schema migration
- Backend unit tests for new endpoints (CRUD teammate_emails, tag autocomplete)
- Backend unit tests for clip save/update with new fields
- Verify existing clip endpoints still work with NULL tagged_teammates

## Files Affected

- `src/backend/app/database.py` -- schema migration
- `src/backend/app/routers/games.py` -- clip save/update accepts new fields
- `src/backend/app/routers/profiles.py` (or new router) -- teammate-tags, teammate-emails endpoints
- `src/backend/tests/` -- new test file for teammate tag CRUD

## Estimate

~150 LOC backend, ~50 LOC tests
