# Consolidate Clip Identity Logic

**Priority**: 3
**Smell**: Shotgun Surgery
**Pattern**: Move Method / Extract Class

---

## Current State

Clip identity (determining which clips are "the same" across versions) uses:

```sql
COALESCE(rc.end_time, wc.uploaded_filename)
```

This expression determines that two `working_clips` rows represent versions of the same logical clip.

---

## Problem

- Identity logic spread across multiple files
- If identity logic changes, must update multiple locations
- Easy to get wrong (we had bugs with `raw_clip_id` vs `end_time`)
- The COALESCE pattern requires understanding the data model

---

## Current Locations

| File | Line | Context |
|------|------|---------|
| `app/routers/clips.py` | 192 | `PARTITION BY COALESCE(rc3.end_time, wc3.uploaded_filename)` |
| `app/routers/export.py` | 1736 | `PARTITION BY COALESCE(rc.end_time, wc.uploaded_filename)` |
| `app/routers/projects.py` | 104 | `PARTITION BY COALESCE(rc2.end_time, wc2.uploaded_filename)` |
| `app/routers/projects.py` | 224 | `PARTITION BY COALESCE(rc2.end_time, wc2.uploaded_filename)` |

---

## Proposed Change

### Option A: Computed Column on Insert

Add a `clip_identity_key` column that is populated when a working_clip is created:

```sql
ALTER TABLE working_clips ADD COLUMN clip_identity_key TEXT;
```

Populate on insert:
```python
# In clips.py create_working_clip()
if raw_clip_id:
    cursor.execute("SELECT end_time FROM raw_clips WHERE id = ?", (raw_clip_id,))
    identity_key = str(cursor.fetchone()['end_time'])
else:
    identity_key = uploaded_filename

cursor.execute("""
    INSERT INTO working_clips (..., clip_identity_key)
    VALUES (..., ?)
""", (..., identity_key))
```

Queries simplify to:
```sql
PARTITION BY wc.clip_identity_key
```

### Option B: Python Helper Function

```python
# In app/database.py or new app/clip_utils.py

def get_clip_identity_expression(wc_alias: str = "wc", rc_alias: str = "rc") -> str:
    """
    Returns SQL expression for clip identity.

    Clip identity determines which working_clips are versions of the same logical clip.
    - For clips from raw_clips: use raw_clip end_time (unique per raw clip)
    - For uploaded clips: use uploaded_filename

    Args:
        wc_alias: Alias for working_clips table
        rc_alias: Alias for raw_clips table (must be LEFT JOINed)

    Returns:
        SQL expression string
    """
    return f"COALESCE({rc_alias}.end_time, {wc_alias}.uploaded_filename)"


def get_clip_identity_key(raw_clip_id: int, uploaded_filename: str, cursor) -> str:
    """
    Compute clip identity key for a specific clip.

    Args:
        raw_clip_id: ID of associated raw_clip (or None for uploaded clips)
        uploaded_filename: Filename for uploaded clips
        cursor: Database cursor

    Returns:
        String identity key
    """
    if raw_clip_id:
        cursor.execute("SELECT end_time FROM raw_clips WHERE id = ?", (raw_clip_id,))
        row = cursor.fetchone()
        return str(row['end_time']) if row else uploaded_filename
    return uploaded_filename
```

---

## Files to Update

| File | Line | Current | After Refactor |
|------|------|---------|----------------|
| `app/routers/clips.py` | 192 | `COALESCE(rc3.end_time, wc3.uploaded_filename)` | `{get_clip_identity_expression('wc3', 'rc3')}` or `wc3.clip_identity_key` |
| `app/routers/export.py` | 1736 | `COALESCE(rc.end_time, wc.uploaded_filename)` | Use helper |
| `app/routers/projects.py` | 104 | `COALESCE(rc2.end_time, wc2.uploaded_filename)` | Use helper |
| `app/routers/projects.py` | 224 | `COALESCE(rc2.end_time, wc2.uploaded_filename)` | Use helper |

---

## Tests to Write BEFORE Refactor

Write these tests to verify clip identity logic works correctly. All must pass before AND after refactor.

### Test File: `src/backend/tests/test_clip_identity.py`

```python
"""
Tests for clip identity logic.
Clip identity determines which working_clips are versions of the same logical clip.
Run BEFORE refactor to verify current behavior, then AFTER to verify no regression.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection

client = TestClient(app)


class TestClipIdentityFromRawClip:
    """Test identity for clips created from raw_clips."""

    def test_same_raw_clip_creates_same_identity(self, db_connection):
        """Two working_clips with same raw_clip_id should have same identity."""
        cursor = db_connection.cursor()

        # Create raw clip
        cursor.execute("""
            INSERT INTO raw_clips (game_id, filename, end_time)
            VALUES (1, 'test.mp4', 12345)
        """)
        raw_clip_id = cursor.lastrowid

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Identity Test')")
        project_id = cursor.lastrowid

        # Create two working clips from same raw clip (different versions)
        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, version)
            VALUES (?, ?, 1)
        """, (project_id, raw_clip_id))
        clip1_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, version)
            VALUES (?, ?, 2)
        """, (project_id, raw_clip_id))
        clip2_id = cursor.lastrowid

        db_connection.commit()

        # Query should return only the latest version (version 2)
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        assert len(clips) == 1
        assert clips[0]["version"] == 2

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()

    def test_different_raw_clips_have_different_identity(self, db_connection):
        """Two working_clips from different raw_clips should be different clips."""
        cursor = db_connection.cursor()

        # Create two raw clips
        cursor.execute("""
            INSERT INTO raw_clips (game_id, filename, end_time)
            VALUES (1, 'test1.mp4', 11111)
        """)
        raw_clip_id_1 = cursor.lastrowid

        cursor.execute("""
            INSERT INTO raw_clips (game_id, filename, end_time)
            VALUES (1, 'test2.mp4', 22222)
        """)
        raw_clip_id_2 = cursor.lastrowid

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Identity Test 2')")
        project_id = cursor.lastrowid

        # Create working clips from different raw clips
        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, version)
            VALUES (?, ?, 1)
        """, (project_id, raw_clip_id_1))

        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, version)
            VALUES (?, ?, 1)
        """, (project_id, raw_clip_id_2))

        db_connection.commit()

        # Query should return both clips (different identities)
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        assert len(clips) == 2

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM raw_clips WHERE id IN (?, ?)", (raw_clip_id_1, raw_clip_id_2))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()


class TestClipIdentityFromUpload:
    """Test identity for uploaded clips (no raw_clip)."""

    def test_same_filename_creates_same_identity(self, db_connection):
        """Uploaded clips with same filename should have same identity."""
        cursor = db_connection.cursor()

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Upload Identity Test')")
        project_id = cursor.lastrowid

        # Create two working clips with same filename (different versions)
        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version)
            VALUES (?, 'uploaded.mp4', 1)
        """, (project_id,))

        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version)
            VALUES (?, 'uploaded.mp4', 2)
        """, (project_id,))

        db_connection.commit()

        # Query should return only the latest version
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        assert len(clips) == 1
        assert clips[0]["version"] == 2

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()

    def test_different_filenames_have_different_identity(self, db_connection):
        """Uploaded clips with different filenames should be different clips."""
        cursor = db_connection.cursor()

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Upload Identity Test 2')")
        project_id = cursor.lastrowid

        # Create working clips with different filenames
        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version)
            VALUES (?, 'file1.mp4', 1)
        """, (project_id,))

        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version)
            VALUES (?, 'file2.mp4', 1)
        """, (project_id,))

        db_connection.commit()

        # Query should return both clips
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        assert len(clips) == 2

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()


class TestMixedClipIdentity:
    """Test identity with mix of raw_clip and uploaded clips."""

    def test_raw_clip_and_uploaded_have_different_identity(self, db_connection):
        """A raw_clip-based and uploaded clip should always be different."""
        cursor = db_connection.cursor()

        # Create raw clip
        cursor.execute("""
            INSERT INTO raw_clips (game_id, filename, end_time)
            VALUES (1, 'raw.mp4', 99999)
        """)
        raw_clip_id = cursor.lastrowid

        # Create project
        cursor.execute("INSERT INTO projects (name) VALUES ('Mixed Identity Test')")
        project_id = cursor.lastrowid

        # Create one raw_clip-based and one uploaded clip
        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, version)
            VALUES (?, ?, 1)
        """, (project_id, raw_clip_id))

        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version)
            VALUES (?, 'uploaded.mp4', 1)
        """, (project_id,))

        db_connection.commit()

        # Query should return both clips (different identities)
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        assert len(clips) == 2

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()


class TestIdentityKeyComputation:
    """Test the identity key computation helper (after refactor)."""

    def test_get_clip_identity_key_with_raw_clip(self, db_connection):
        """Helper should return raw_clip.end_time for raw_clip-based clips."""
        # This test is for AFTER refactor when helper exists
        # Skip if helper doesn't exist yet
        try:
            from app.clip_utils import get_clip_identity_key
        except ImportError:
            pytest.skip("get_clip_identity_key not implemented yet")

        cursor = db_connection.cursor()

        cursor.execute("""
            INSERT INTO raw_clips (game_id, filename, end_time)
            VALUES (1, 'test.mp4', 12345)
        """)
        raw_clip_id = cursor.lastrowid
        db_connection.commit()

        identity_key = get_clip_identity_key(raw_clip_id, None, cursor)
        assert identity_key == "12345"

        # Cleanup
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        db_connection.commit()

    def test_get_clip_identity_key_with_upload(self, db_connection):
        """Helper should return filename for uploaded clips."""
        try:
            from app.clip_utils import get_clip_identity_key
        except ImportError:
            pytest.skip("get_clip_identity_key not implemented yet")

        cursor = db_connection.cursor()

        identity_key = get_clip_identity_key(None, "my_upload.mp4", cursor)
        assert identity_key == "my_upload.mp4"
```

---

## Test Execution Plan

### Phase 1: Before Refactor
1. Write all tests in `test_clip_identity.py`
2. Run tests: `pytest src/backend/tests/test_clip_identity.py -v`
3. All tests must PASS (except helper tests which should skip)
4. Commit: "Add tests for clip identity logic"

### Phase 2: Implement Helper
1. Create `app/clip_utils.py` with helper functions
2. Unit test the helpers:
   ```python
   def test_get_clip_identity_expression():
       expr = get_clip_identity_expression("wc", "rc")
       assert expr == "COALESCE(rc.end_time, wc.uploaded_filename)"

   def test_get_clip_identity_expression_custom_aliases():
       expr = get_clip_identity_expression("wc2", "rc2")
       assert expr == "COALESCE(rc2.end_time, wc2.uploaded_filename)"
   ```

### Phase 3: Replace Inline COALESCE
1. Update each file one at a time
2. Run `test_clip_identity.py` after each change
3. Order:
   - `clips.py`
   - `projects.py` (both locations)
   - `export.py`

### Phase 4: After Refactor
1. Run full test suite: `pytest src/backend/tests/ -v`
2. Verify no inline COALESCE remains: `grep -r "COALESCE.*end_time.*uploaded_filename" app/routers/`
3. Commit: "Consolidate clip identity logic to helper"

---

## Benefits

- Single source of truth for clip identity logic
- Easier to change identity algorithm if needed
- Self-documenting code
- Reduces chance of bugs from inconsistent implementations
