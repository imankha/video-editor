# T1620: Sport-Specific Tag Definitions

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-04-20
**Updated:** 2026-05-08

## Problem

Annotation tags are hardcoded for soccer only (`soccerTags.js`). With sport
selection on the profile (T1610), we need tag definitions for all six supported
sports, stored in a way that supports user editing (T1625).

## Solution

### Database Schema

Create a `sport_tags` table in the user database to store tag definitions:

```sql
CREATE TABLE IF NOT EXISTS sport_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sport TEXT NOT NULL,
    position_id TEXT,          -- nullable: tags without a position group
    position_name TEXT,        -- display name for the position
    position_order INTEGER,    -- sort order within the sport
    tag_name TEXT NOT NULL,
    tag_description TEXT,
    tag_order INTEGER,         -- sort order within the position
    UNIQUE(sport, position_id, tag_name)
);
```

### Seed Data

Pre-canned tag definitions for all six sports, sourced from the
[Sport Tags Reference](sport-tags-reference.md):

1. **Soccer** -- 4 positions, 11 tags
2. **Flag Football** -- 5 positions, 14 tags
3. **American Football** -- 8 positions, 21 tags
4. **Basketball** -- 3 positions, 6 tags (some shared across positions)
5. **Lacrosse** -- 4 positions, 10 tags
6. **Rugby** -- 3 positions, 9 tags

### Seeding Logic

When a user selects a supported sport for the first time on any profile:
- Check if `sport_tags` has any rows for that sport
- If not, insert the seed data for that sport
- If yes (user already has tags for that sport, possibly edited), do nothing

This ensures pre-canned tags are available immediately but never overwrite
user edits.

### Backend

- Migration script to create the `sport_tags` table
- Seed data as a Python dict/JSON matching the reference document
- API endpoints for reading tags by sport (used by annotation UI)
- Seeding triggered by profile sport change (T1610 API)

### Frontend

- Remove hardcoded `soccerTags.js` as the source of truth (keep as reference)
- Tag registry reads from the API instead of static imports

## Relevant Files

- `src/backend/app/services/user_db.py` -- database schema
- `src/frontend/src/modes/annotate/constants/soccerTags.js` -- current static tags
- [Sport Tags Reference](sport-tags-reference.md) -- all tag definitions

## Depends On

- T1610 (profile sport field)

## Acceptance Criteria

- [ ] `sport_tags` table exists in user database
- [ ] Seed data covers all six supported sports
- [ ] Seed data matches the Sport Tags Reference document
- [ ] Tags are seeded on first sport selection, not on every load
- [ ] API endpoint returns tags grouped by position for a given sport
- [ ] Unsupported/custom sports return empty tag set from API
