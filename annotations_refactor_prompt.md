# Annotations Refactor: TSV Files to Database

## Status: NOT STARTED
**Last Updated:** 2026-01-01
**Current Phase:** Design Complete, Awaiting Pre-Refactor Tests

---

## Overview

Migrate game annotations from TSV files to SQLite database using a hybrid approach: normalized `annotations` table with cached aggregates on the `games` table for fast queries.

### Why This Refactor?
1. **Performance**: `list_games()` currently parses ALL TSV files just to get clip counts - O(n) file reads
2. **Single Source of Truth**: Eliminate redundant data between TSV files and potential future DB storage
3. **Queryability**: Enable filtering games by rating stats, aggregate scores
4. **Scalability**: Support hundreds of games with instant list loading

### Terminology Note
- **Annotation**: A marked region in game footage (start_time, end_time, rating, tags, notes, name)
- **Clip**: The video file produced after FFmpeg cuts an annotation from source video
- We use "annotations" for the DB table to avoid confusion with `raw_clips` table

---

## Current Architecture

### Files Involved

| File | Purpose | Changes Needed |
|------|---------|----------------|
| `src/backend/app/database.py` | DB connection, schema | Add `annotations` table, modify `games` table |
| `src/backend/app/routers/games.py` | Game CRUD, annotation I/O | Replace TSV functions with DB queries |
| `src/frontend/src/hooks/useGames.js` | Frontend game API | Minor: response shape changes |
| `src/frontend/src/modes/annotate/hooks/useAnnotate.js` | Annotation state | Minor: import function |
| `src/frontend/src/App.jsx` | Orchestration | Minor: data flow |

### Current Data Flow

```
[Frontend]
    │
    ▼ saveAnnotations(gameId, annotations[])
[games.py: save_annotations()]
    │
    ▼ Write to TSV file
[GAMES_PATH/{base}_annotations.tsv]

[Frontend]
    │
    ▼ getGame(gameId)
[games.py: get_game()]
    │
    ▼ load_annotations() parses TSV
[Return annotations array]
```

### Current TSV Format
```
start_time	rating	tags	clip_name	clip_duration	notes
1:30	5	Goal,Dribble	Brilliant Goal	15	Amazing finish
```

---

## Target Architecture

### Database Schema

```sql
-- Modified games table (add aggregate columns)
ALTER TABLE games ADD COLUMN clip_count INTEGER DEFAULT 0;
ALTER TABLE games ADD COLUMN brilliant_count INTEGER DEFAULT 0;  -- rating 5
ALTER TABLE games ADD COLUMN good_count INTEGER DEFAULT 0;       -- rating 4
ALTER TABLE games ADD COLUMN interesting_count INTEGER DEFAULT 0; -- rating 3
ALTER TABLE games ADD COLUMN mistake_count INTEGER DEFAULT 0;    -- rating 2
ALTER TABLE games ADD COLUMN blunder_count INTEGER DEFAULT 0;    -- rating 1
ALTER TABLE games ADD COLUMN aggregate_score INTEGER DEFAULT 0;  -- weighted sum

-- New annotations table
CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    name TEXT DEFAULT '',
    rating INTEGER DEFAULT 3 CHECK (rating >= 1 AND rating <= 5),
    tags TEXT DEFAULT '[]',  -- JSON array
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX idx_annotations_game_id ON annotations(game_id);
CREATE INDEX idx_annotations_rating ON annotations(rating);
```

### Aggregate Score Formula
```python
# Weighted score that rewards good clips and penalizes bad ones
aggregate_score = (
    brilliant_count * 10 +   # !! = 10 points
    good_count * 5 +         # !  = 5 points
    interesting_count * 2 +  # !? = 2 points
    mistake_count * -2 +     # ?  = -2 points
    blunder_count * -5       # ?? = -5 points
)
```

### Target Data Flow

```
[Frontend]
    │
    ▼ saveAnnotations(gameId, annotations[])
[games.py: save_annotations()]
    │
    ├─▶ DELETE FROM annotations WHERE game_id = ?
    ├─▶ INSERT INTO annotations (batch)
    └─▶ UPDATE games SET clip_count=?, brilliant_count=?, ... WHERE id=?
[SQLite DB]

[Frontend]
    │
    ▼ getGame(gameId)
[games.py: get_game()]
    │
    ▼ SELECT * FROM annotations WHERE game_id = ?
[Return annotations array]

[Frontend]
    │
    ▼ listGames()
[games.py: list_games()]
    │
    ▼ SELECT id, name, clip_count, aggregate_score, ... FROM games
[No TSV parsing needed!]
```

---

## API Changes

### GET /api/games (list_games)
**Before:**
```json
{
  "games": [
    {"id": 1, "name": "Game 1", "clip_count": 5, ...}
  ]
}
```

**After:**
```json
{
  "games": [
    {
      "id": 1,
      "name": "Game 1",
      "clip_count": 5,
      "brilliant_count": 2,
      "good_count": 1,
      "interesting_count": 1,
      "mistake_count": 1,
      "blunder_count": 0,
      "aggregate_score": 28,
      ...
    }
  ]
}
```

### GET /api/games/{id} (get_game)
No change to response shape - annotations array stays the same.

### PUT /api/games/{id}/annotations (save_annotations)
No change to request shape - accepts annotations array.

### POST /api/games/{id}/annotations/import (NEW - optional)
Import TSV content into existing game's annotations.

---

## Migration Strategy

### Phase 1: Schema Migration
1. Add new columns to `games` table
2. Create `annotations` table
3. Keep TSV functions temporarily for migration

### Phase 2: Data Migration
```python
def migrate_tsv_to_db():
    """One-time migration of all existing TSV files to database."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, annotations_filename FROM games")
        games = cursor.fetchall()

        for game in games:
            if not game['annotations_filename']:
                continue

            # Load from TSV
            annotations = load_annotations_from_tsv(game['annotations_filename'])

            # Insert into DB
            for ann in annotations:
                cursor.execute("""
                    INSERT INTO annotations (game_id, start_time, end_time, name, rating, tags, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (game['id'], ann['start_time'], ann['end_time'],
                      ann['name'], ann['rating'], json.dumps(ann['tags']), ann['notes']))

            # Update aggregates
            update_game_aggregates(cursor, game['id'])

        conn.commit()
```

### Phase 3: Code Migration
1. Update `save_annotations()` to write to DB
2. Update `get_game()` to read from DB
3. Update `list_games()` to use cached aggregates
4. Keep `annotations_filename` column for backward compatibility (nullable)

### Phase 4: Cleanup
1. Remove TSV file operations (keep import capability)
2. Remove `annotations_filename` column (optional, low priority)
3. Delete old TSV files (manual, after verification)

---

## Files to Modify

### Backend

#### `src/backend/app/database.py`
- [ ] Add `annotations` table to schema
- [ ] Add aggregate columns to `games` table
- [ ] Add migration function for existing data

#### `src/backend/app/routers/games.py`
- [ ] Remove: `load_annotations()` (TSV parsing)
- [ ] Remove: `save_annotations()` (TSV writing)
- [ ] Remove: `get_annotations_path()`
- [ ] Remove: `format_time_for_tsv()`, `parse_time_from_tsv()`
- [ ] Add: `load_annotations_from_db(game_id)`
- [ ] Add: `save_annotations_to_db(game_id, annotations)`
- [ ] Add: `update_game_aggregates(cursor, game_id)`
- [ ] Add: `import_tsv_to_game(game_id, tsv_content)` - for TSV import feature
- [ ] Modify: `list_games()` - use cached aggregates
- [ ] Modify: `get_game()` - load from DB
- [ ] Modify: `update_annotations()` - save to DB
- [ ] Modify: `create_game()` - initialize aggregates to 0
- [ ] Modify: `delete_game()` - CASCADE handles annotation deletion

### Frontend (minimal changes)

#### `src/frontend/src/hooks/useGames.js`
- [ ] Update TypeScript types (if any) for new response fields
- [ ] No functional changes needed - same API shape

#### `src/frontend/src/modes/annotate/hooks/useAnnotate.js`
- [ ] `validateTsvContent()` - keep for import feature
- [ ] `importAnnotations()` - keep, works with same data shape

---

## Test Plan

### Pre-Refactor Tests (MUST PASS BEFORE REFACTOR)

Create `src/backend/tests/test_annotations_pre_refactor.py`:

```python
"""
Pre-refactor tests for annotations functionality.
These tests document current behavior and MUST pass before AND after refactor.
Run with: pytest src/backend/tests/test_annotations_pre_refactor.py -v
"""

import pytest
import tempfile
import os
from pathlib import Path

# Test fixtures and setup...

class TestListGames:
    """Test GET /api/games endpoint."""

    def test_list_games_returns_clip_count(self, client, game_with_annotations):
        """Clip count should be returned for each game."""
        response = client.get("/api/games")
        assert response.status_code == 200
        games = response.json()["games"]
        assert len(games) > 0
        assert "clip_count" in games[0]
        assert games[0]["clip_count"] == 3  # Based on fixture

    def test_list_games_empty(self, client):
        """Empty games list should return empty array."""
        response = client.get("/api/games")
        assert response.status_code == 200
        assert response.json()["games"] == []


class TestGetGame:
    """Test GET /api/games/{id} endpoint."""

    def test_get_game_returns_annotations(self, client, game_with_annotations):
        """Should return full annotations array."""
        response = client.get(f"/api/games/{game_with_annotations['id']}")
        assert response.status_code == 200
        data = response.json()
        assert "annotations" in data
        assert len(data["annotations"]) == 3

    def test_get_game_annotation_shape(self, client, game_with_annotations):
        """Each annotation should have required fields."""
        response = client.get(f"/api/games/{game_with_annotations['id']}")
        ann = response.json()["annotations"][0]
        assert "start_time" in ann
        assert "end_time" in ann
        assert "name" in ann
        assert "rating" in ann
        assert "tags" in ann
        assert "notes" in ann

    def test_get_game_not_found(self, client):
        """Should return 404 for non-existent game."""
        response = client.get("/api/games/99999")
        assert response.status_code == 404


class TestSaveAnnotations:
    """Test PUT /api/games/{id}/annotations endpoint."""

    def test_save_annotations_creates(self, client, empty_game):
        """Should save new annotations."""
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "Test", "rating": 5, "tags": ["Goal"], "notes": ""}
        ]
        response = client.put(
            f"/api/games/{empty_game['id']}/annotations",
            json=annotations
        )
        assert response.status_code == 200
        assert response.json()["clip_count"] == 1

    def test_save_annotations_updates(self, client, game_with_annotations):
        """Should replace existing annotations."""
        new_annotations = [
            {"start_time": 5, "end_time": 20, "name": "New", "rating": 4, "tags": [], "notes": "updated"}
        ]
        response = client.put(
            f"/api/games/{game_with_annotations['id']}/annotations",
            json=new_annotations
        )
        assert response.status_code == 200
        assert response.json()["clip_count"] == 1

        # Verify update
        get_response = client.get(f"/api/games/{game_with_annotations['id']}")
        assert len(get_response.json()["annotations"]) == 1
        assert get_response.json()["annotations"][0]["name"] == "New"

    def test_save_empty_annotations(self, client, game_with_annotations):
        """Should allow saving empty annotations array."""
        response = client.put(
            f"/api/games/{game_with_annotations['id']}/annotations",
            json=[]
        )
        assert response.status_code == 200
        assert response.json()["clip_count"] == 0


class TestDeleteGame:
    """Test DELETE /api/games/{id} endpoint."""

    def test_delete_game_removes_annotations(self, client, game_with_annotations):
        """Deleting game should remove its annotations."""
        game_id = game_with_annotations['id']
        response = client.delete(f"/api/games/{game_id}")
        assert response.status_code == 200

        # Verify game is gone
        get_response = client.get(f"/api/games/{game_id}")
        assert get_response.status_code == 404


class TestAnnotationDataIntegrity:
    """Test data integrity across operations."""

    def test_rating_preserved(self, client, empty_game):
        """Rating values 1-5 should be preserved exactly."""
        for rating in [1, 2, 3, 4, 5]:
            annotations = [
                {"start_time": 10, "end_time": 25, "name": f"R{rating}", "rating": rating, "tags": [], "notes": ""}
            ]
            client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
            response = client.get(f"/api/games/{empty_game['id']}")
            assert response.json()["annotations"][0]["rating"] == rating

    def test_tags_preserved(self, client, empty_game):
        """Tags array should be preserved exactly."""
        tags = ["Goal", "Dribble", "Assist"]
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "Test", "rating": 5, "tags": tags, "notes": ""}
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
        response = client.get(f"/api/games/{empty_game['id']}")
        assert response.json()["annotations"][0]["tags"] == tags

    def test_times_preserved(self, client, empty_game):
        """Start and end times should be preserved with precision."""
        annotations = [
            {"start_time": 90.5, "end_time": 105.75, "name": "Test", "rating": 3, "tags": [], "notes": ""}
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
        response = client.get(f"/api/games/{empty_game['id']}")
        ann = response.json()["annotations"][0]
        assert ann["start_time"] == 90.5
        assert ann["end_time"] == 105.75

    def test_notes_with_special_chars(self, client, empty_game):
        """Notes with special characters should be preserved."""
        notes = "Test with 'quotes' and \"double quotes\" and\ttabs"
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "Test", "rating": 3, "tags": [], "notes": notes}
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
        response = client.get(f"/api/games/{empty_game['id']}")
        assert response.json()["annotations"][0]["notes"] == notes
```

### Post-Refactor Tests (NEW FUNCTIONALITY)

Create `src/backend/tests/test_annotations_aggregates.py`:

```python
"""
Tests for new aggregate functionality after refactor.
"""

class TestGameAggregates:
    """Test aggregate columns on games table."""

    def test_aggregates_computed_on_save(self, client, empty_game):
        """Saving annotations should update aggregate counts."""
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "A", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 30, "end_time": 45, "name": "B", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 50, "end_time": 65, "name": "C", "rating": 4, "tags": [], "notes": ""},
            {"start_time": 70, "end_time": 85, "name": "D", "rating": 1, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)

        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])

        assert game["clip_count"] == 4
        assert game["brilliant_count"] == 2
        assert game["good_count"] == 1
        assert game["blunder_count"] == 1
        # aggregate_score = 2*10 + 1*5 + 0*2 + 0*(-2) + 1*(-5) = 20
        assert game["aggregate_score"] == 20

    def test_aggregates_update_on_change(self, client, game_with_annotations):
        """Changing annotations should update aggregates."""
        # Save different annotations
        new_annotations = [
            {"start_time": 10, "end_time": 25, "name": "Only", "rating": 3, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{game_with_annotations['id']}/annotations", json=new_annotations)

        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == game_with_annotations['id'])

        assert game["clip_count"] == 1
        assert game["interesting_count"] == 1
        assert game["brilliant_count"] == 0


class TestTsvImport:
    """Test TSV import into database."""

    def test_import_tsv_content(self, client, empty_game):
        """Should import TSV content into game's annotations."""
        tsv_content = """start_time\trating\ttags\tclip_name\tclip_duration\tnotes
1:30\t5\tGoal\tBrilliant Goal\t15\tAmazing
2:00\t4\tPass\tGood Pass\t10\t"""

        response = client.post(
            f"/api/games/{empty_game['id']}/annotations/import",
            data={"tsv_content": tsv_content}
        )
        assert response.status_code == 200

        # Verify imported
        get_response = client.get(f"/api/games/{empty_game['id']}")
        annotations = get_response.json()["annotations"]
        assert len(annotations) == 2
        assert annotations[0]["rating"] == 5
        assert annotations[0]["name"] == "Brilliant Goal"
```

---

## Task Checklist

### Phase 0: Pre-Refactor Testing
- [ ] Create test file `src/backend/tests/test_annotations_pre_refactor.py`
- [ ] Create test fixtures (empty game, game with annotations)
- [ ] Run tests - ALL MUST PASS
- [ ] Commit tests separately: "test: add pre-refactor annotation tests"

### Phase 1: Schema Migration
- [ ] Add columns to `games` table in `database.py`
- [ ] Add `annotations` table in `database.py`
- [ ] Add `init_schema()` migration logic
- [ ] Test schema creation on fresh DB
- [ ] Commit: "feat: add annotations table schema"

### Phase 2: Data Migration
- [ ] Add `migrate_tsv_to_db()` function
- [ ] Add migration endpoint or CLI command
- [ ] Test migration with existing games
- [ ] Verify data integrity after migration
- [ ] Commit: "feat: add TSV to DB migration"

### Phase 3: Code Migration
- [ ] Implement `load_annotations_from_db()`
- [ ] Implement `save_annotations_to_db()`
- [ ] Implement `update_game_aggregates()`
- [ ] Update `list_games()` to use cached aggregates
- [ ] Update `get_game()` to read from DB
- [ ] Update `update_annotations()` to save to DB
- [ ] Update `create_game()` to initialize aggregates
- [ ] Run pre-refactor tests - ALL MUST PASS
- [ ] Commit: "refactor: migrate annotations to database"

### Phase 4: New Features
- [ ] Add TSV import endpoint
- [ ] Add aggregate fields to list_games response
- [ ] Create post-refactor tests
- [ ] Run all tests
- [ ] Commit: "feat: add annotation aggregates and TSV import"

### Phase 5: Cleanup
- [ ] Remove TSV file functions (keep import parser)
- [ ] Update API documentation
- [ ] Final test run
- [ ] Commit: "chore: remove legacy TSV file operations"

---

## Handoff Notes

### For Next Session
1. Start with Phase 0 - create and run pre-refactor tests
2. Tests are the safety net - do not skip
3. Each phase should be a separate commit
4. Run tests after each phase

### Key Decisions Made
- Table named `annotations` (not `clips`) to avoid confusion with `raw_clips`
- Using JSON string for tags (not separate junction table) - simpler, adequate for our scale
- Aggregate score formula weights brilliants heavily, penalizes blunders
- Keeping TSV import capability for external annotation workflows
- CASCADE delete for annotations when game deleted

### Potential Issues
- Large TSV files during migration - batch inserts if needed
- Frontend expects `annotations` array in get_game response - shape unchanged
- Debounced saves from frontend - DB handles concurrent writes fine

### Files NOT to Modify
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` - TSV validation stays for import
- `src/backend/app/routers/annotate.py` - Export uses annotation data, not source
- Frontend components - they consume same data shape

---

## Implementation Details

### Auto-Save Behavior
- Frontend uses 500ms debounced save (`saveAnnotationsDebounced` in `useGames.js`)
- Every annotation change (add/edit/delete) triggers a save after debounce settles
- Expect frequent writes - DB batch replace handles this well
- Location: `src/frontend/src/hooks/useGames.js` lines 246-257

### Frontend ID vs Database ID
- Frontend generates UUID for each annotation via `crypto.randomUUID()` in `useAnnotate.js`
- **Decision**: Use DB auto-increment `id`, ignore frontend UUIDs
- Frontend IDs are ephemeral (regenerated on page load from DB data)
- No need for `frontend_id` column - annotations identified by `game_id` + `start_time` + `end_time`

### Relationship: annotations vs raw_clips
```
annotations (this refactor)     raw_clips (existing)
─────────────────────────────   ────────────────────
Time markers on game video  →   Actual video files cut by FFmpeg
Stored in DB                    Stored in DB + filesystem
Many per game                   Created during export
No video file                   Has video file (raw_clips/*.mp4)
```
- Export flow: annotations → FFmpeg → raw_clips
- One-way relationship: raw_clips are PRODUCED FROM annotations
- Deleting annotation does NOT delete any raw_clips created from it

### Default Name Generation
- Function: `generate_clip_name(rating, tags)` in `games.py`
- Creates names like "Brilliant Goal", "Good Pass and Dribble"
- Called when `name` field is empty
- **Keep this logic in backend** - run on read if `name` is empty string
- Location: `src/backend/app/routers/games.py` lines 62-81

### Sort Order
- UI sorts annotations by `end_time` (ClipsSidePanel, ClipRegionLayer)
- No explicit `sort_order` column needed
- Query: `SELECT * FROM annotations WHERE game_id = ? ORDER BY end_time`

### Existing Games Table Columns (unchanged)
```sql
-- These columns already exist and stay as-is:
video_duration REAL,      -- For instant video loading
video_width INTEGER,
video_height INTEGER,
video_size INTEGER,
annotations_filename TEXT  -- Keep for migration, nullable after
```

### TSV Format Quirk: Duration vs End Time
**Current TSV stores duration, not end_time:**
```
start_time  clip_duration  → end_time calculated
1:30        15             → 90 + 15 = 105
```
**DB stores end_time directly:**
```sql
start_time REAL,  -- 90.0
end_time REAL,    -- 105.0
```
- Migration must calculate: `end_time = start_time + clip_duration`
- TSV import must also do this conversion

### Concurrent Write Handling
- SQLite handles concurrent writes via locking
- Frontend debounce (500ms) prevents rapid-fire saves
- Batch replace pattern (DELETE + INSERT) is atomic within transaction
- No race conditions expected at our scale

---

## Rollback Plan

If issues arise after deployment:
1. Schema changes are additive - old code won't break
2. Keep TSV files until verified (don't delete immediately)
3. Can revert to TSV by re-enabling old functions
4. Migration is one-way but TSV files are backup

---

## Success Criteria

1. `list_games()` returns instantly (no TSV parsing)
2. All pre-refactor tests pass
3. Aggregate counts visible in games list
4. TSV import still works
5. No data loss from migration
6. Frontend behavior unchanged

---

## Current Code Locations Reference

### Backend: `src/backend/app/routers/games.py`
| Lines | Function | Purpose | Action |
|-------|----------|---------|--------|
| 29-30 | `TSV_COLUMNS` | TSV header definition | Keep for import |
| 32-59 | `RATING_ADJECTIVES`, `TAG_SHORT_NAMES` | Name generation mappings | Keep |
| 62-81 | `generate_clip_name()` | Default name from rating+tags | Keep |
| 84-97 | `format_time_for_tsv()`, `parse_time_from_tsv()` | TSV time parsing | Keep for import |
| 100-102 | `get_annotations_path()` | TSV file path | Remove after migration |
| 105-155 | `load_annotations()` | Parse TSV to annotations list | Replace with DB query |
| 158-188 | `save_annotations()` | Write annotations to TSV | Replace with DB insert |
| 191-217 | `list_games()` | GET /api/games | Modify: use cached aggregates |
| 381-413 | `get_game()` | GET /api/games/{id} | Modify: load from DB |
| 440-482 | `update_annotations()` | PUT /api/games/{id}/annotations | Modify: save to DB |

### Backend: `src/backend/app/database.py`
| Section | Purpose | Action |
|---------|---------|--------|
| `GAMES_PATH` | Path constant | Keep |
| `init_schema()` | Create tables | Add annotations table, aggregate columns |
| `get_db_connection()` | DB connection | Keep |

### Frontend: `src/frontend/src/hooks/useGames.js`
| Lines | Function | Purpose | Action |
|-------|----------|---------|--------|
| 148-167 | `getGame()` | Fetch single game | No change |
| 211-240 | `saveAnnotations()` | Save to backend | No change |
| 246-257 | `saveAnnotationsDebounced()` | 500ms debounce | No change |

### Frontend: `src/frontend/src/modes/annotate/hooks/useAnnotate.js`
| Function | Purpose | Action |
|----------|---------|--------|
| `validateTsvContent()` | Parse/validate TSV for import | Keep |
| `importAnnotations()` | Add imported annotations to state | Keep |
| `clipRegions` state | In-memory annotation list | No change |

### Frontend: `src/frontend/src/App.jsx`
| Lines | Function | Purpose | Action |
|-------|----------|---------|--------|
| 866-922 | `handleLoadGame()` | Load game into annotate mode | No change |
| 1501-1512 | Auto-save effect | Debounced save on change | No change |
