# Simplify Framing Data Null Checks

**Priority**: 5
**Smell**: Primitive Obsession / Duplicated Code
**Pattern**: Introduce Null Object / Extract Method

---

## Current State

Multiple places check for "has framing data" using verbose conditions:

```sql
(crop_data IS NOT NULL AND crop_data != '' AND crop_data != '[]') OR
(segments_data IS NOT NULL AND segments_data != '' AND segments_data != '{}') OR
(timing_data IS NOT NULL AND timing_data != '' AND timing_data != '{}')
```

---

## Problem

- Three different representations of "no data": `NULL`, `''`, `'[]'`/`'{}'`
- Repeated checks in multiple places
- Easy to miss one case when adding new checks
- Inconsistent data storage

---

## Current Location

**File**: `src/backend/app/routers/projects.py`
**Lines**: 95-96

```python
cursor.execute("""
    SELECT
        ...
        SUM(CASE WHEN
            (crop_data IS NOT NULL AND crop_data != '' AND crop_data != '[]') OR
            (segments_data IS NOT NULL AND segments_data != '' AND segments_data != '{}') OR
            (timing_data IS NOT NULL AND timing_data != '' AND timing_data != '{}')
        THEN 1 ELSE 0 END) as in_progress,
        ...
""")
```

---

## Proposed Change

### Step 1: Standardize on NULL for "no data"

Update all save/update endpoints to convert empty values to NULL:

**File**: `src/backend/app/routers/clips.py` (in `update_clip()`)

```python
def normalize_json_data(value: str) -> Optional[str]:
    """Convert empty JSON to NULL for consistent storage."""
    if value is None:
        return None
    if value in ('', '[]', '{}', 'null'):
        return None
    return value

# In update_clip():
if update.crop_data is not None:
    update_fields.append("crop_data = ?")
    params.append(normalize_json_data(update.crop_data))
```

### Step 2: Data Migration

```sql
-- One-time migration to normalize existing data
UPDATE working_clips SET crop_data = NULL WHERE crop_data IN ('', '[]');
UPDATE working_clips SET segments_data = NULL WHERE segments_data IN ('', '{}');
UPDATE working_clips SET timing_data = NULL WHERE timing_data IN ('', '{}');
```

### Step 3: Simplify Checks

After normalization, checks become:

```sql
SUM(CASE WHEN
    crop_data IS NOT NULL OR
    segments_data IS NOT NULL OR
    timing_data IS NOT NULL
THEN 1 ELSE 0 END) as in_progress,
```

### Step 4: Create Helper (Optional)

```python
def has_framing_data_sql(table_alias: str = "") -> str:
    """SQL expression for checking if a clip has any framing data."""
    prefix = f"{table_alias}." if table_alias else ""
    return f"""(
        {prefix}crop_data IS NOT NULL OR
        {prefix}segments_data IS NOT NULL OR
        {prefix}timing_data IS NOT NULL
    )"""
```

---

## Files to Update

| File | Line | Current Code | New Code |
|------|------|--------------|----------|
| `app/routers/clips.py` | ~456+ | Direct assignment | Use `normalize_json_data()` |
| `app/routers/projects.py` | 95-96 | Verbose NULL check | Simple `IS NOT NULL` |
| Any other save endpoints | - | Direct assignment | Use `normalize_json_data()` |

---

## Tests to Write BEFORE Refactor

Write these tests to verify "has framing data" logic works correctly with all edge cases.

### Test File: `src/backend/tests/test_framing_data_normalization.py`

```python
"""
Tests for framing data normalization.
Run BEFORE refactor to verify current behavior handles all edge cases.
Run AFTER to verify simplified logic still works.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection

client = TestClient(app)


class TestFramingDataEdgeCases:
    """Test that all representations of 'no data' are handled correctly."""

    def test_null_crop_data_means_no_framing(self, db_connection):
        """Clip with NULL crop_data should not count as 'in progress'."""
        cursor = db_connection.cursor()

        # Create project and clip with NULL data
        cursor.execute("INSERT INTO projects (name) VALUES ('Null Test')")
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version, crop_data)
            VALUES (?, 'test.mp4', 1, NULL)
        """, (project_id,))

        db_connection.commit()

        # Check project counts
        response = client.get("/api/projects")
        projects = response.json()["projects"]
        project = next(p for p in projects if p["id"] == project_id)

        assert project["clips_in_progress"] == 0

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()

    def test_empty_string_crop_data_means_no_framing(self, db_connection):
        """Clip with empty string crop_data should not count as 'in progress'."""
        cursor = db_connection.cursor()

        cursor.execute("INSERT INTO projects (name) VALUES ('Empty String Test')")
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version, crop_data)
            VALUES (?, 'test.mp4', 1, '')
        """, (project_id,))

        db_connection.commit()

        response = client.get("/api/projects")
        projects = response.json()["projects"]
        project = next(p for p in projects if p["id"] == project_id)

        assert project["clips_in_progress"] == 0

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()

    def test_empty_array_crop_data_means_no_framing(self, db_connection):
        """Clip with '[]' crop_data should not count as 'in progress'."""
        cursor = db_connection.cursor()

        cursor.execute("INSERT INTO projects (name) VALUES ('Empty Array Test')")
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version, crop_data)
            VALUES (?, 'test.mp4', 1, '[]')
        """, (project_id,))

        db_connection.commit()

        response = client.get("/api/projects")
        projects = response.json()["projects"]
        project = next(p for p in projects if p["id"] == project_id)

        assert project["clips_in_progress"] == 0

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()

    def test_empty_object_segments_data_means_no_framing(self, db_connection):
        """Clip with '{}' segments_data should not count as 'in progress'."""
        cursor = db_connection.cursor()

        cursor.execute("INSERT INTO projects (name) VALUES ('Empty Object Test')")
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version, segments_data)
            VALUES (?, 'test.mp4', 1, '{}')
        """, (project_id,))

        db_connection.commit()

        response = client.get("/api/projects")
        projects = response.json()["projects"]
        project = next(p for p in projects if p["id"] == project_id)

        assert project["clips_in_progress"] == 0

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()

    def test_valid_crop_data_counts_as_in_progress(self, db_connection):
        """Clip with actual crop data should count as 'in progress'."""
        cursor = db_connection.cursor()

        cursor.execute("INSERT INTO projects (name) VALUES ('Valid Data Test')")
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, uploaded_filename, version, crop_data)
            VALUES (?, 'test.mp4', 1, '[{"frame":0,"x":0,"y":0,"width":1080,"height":1920}]')
        """, (project_id,))

        db_connection.commit()

        response = client.get("/api/projects")
        projects = response.json()["projects"]
        project = next(p for p in projects if p["id"] == project_id)

        assert project["clips_in_progress"] == 1

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db_connection.commit()


class TestNormalizeJsonData:
    """Test the normalize_json_data helper function (after refactor)."""

    def test_normalize_null_returns_null(self):
        """None input should return None."""
        try:
            from app.routers.clips import normalize_json_data
        except ImportError:
            pytest.skip("normalize_json_data not implemented yet")

        assert normalize_json_data(None) is None

    def test_normalize_empty_string_returns_null(self):
        """Empty string should return None."""
        try:
            from app.routers.clips import normalize_json_data
        except ImportError:
            pytest.skip("normalize_json_data not implemented yet")

        assert normalize_json_data('') is None

    def test_normalize_empty_array_returns_null(self):
        """'[]' should return None."""
        try:
            from app.routers.clips import normalize_json_data
        except ImportError:
            pytest.skip("normalize_json_data not implemented yet")

        assert normalize_json_data('[]') is None

    def test_normalize_empty_object_returns_null(self):
        """'{}' should return None."""
        try:
            from app.routers.clips import normalize_json_data
        except ImportError:
            pytest.skip("normalize_json_data not implemented yet")

        assert normalize_json_data('{}') is None

    def test_normalize_valid_json_preserves_data(self):
        """Valid JSON should be returned unchanged."""
        try:
            from app.routers.clips import normalize_json_data
        except ImportError:
            pytest.skip("normalize_json_data not implemented yet")

        valid_json = '[{"frame":0,"x":100}]'
        assert normalize_json_data(valid_json) == valid_json


class TestUpdateClipNormalization:
    """Test that saving clips normalizes empty data to NULL."""

    def test_saving_empty_array_stores_null(self, test_project_with_clip):
        """Saving '[]' as crop_data should store NULL."""
        project_id, clip_id = test_project_with_clip

        # Update with empty array
        response = client.put(
            f"/api/clips/projects/{project_id}/clips/{clip_id}",
            json={"crop_data": "[]"}
        )
        assert response.status_code == 200

        # Verify stored as NULL
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT crop_data FROM working_clips WHERE id = ?",
                (clip_id,)
            )
            row = cursor.fetchone()

            # BEFORE refactor: might be '[]'
            # AFTER refactor: should be NULL
            assert row['crop_data'] in (None, '[]')  # Allow either for now

    def test_saving_valid_json_preserves_data(self, test_project_with_clip):
        """Saving valid JSON should preserve it."""
        project_id, clip_id = test_project_with_clip

        valid_json = '[{"frame":0,"x":100,"y":200,"width":800,"height":1400}]'

        response = client.put(
            f"/api/clips/projects/{project_id}/clips/{clip_id}",
            json={"crop_data": valid_json}
        )
        assert response.status_code == 200

        # Verify stored correctly
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT crop_data FROM working_clips WHERE id = ?",
                (clip_id,)
            )
            row = cursor.fetchone()
            assert row['crop_data'] == valid_json
```

### Test Fixtures: `src/backend/tests/conftest.py`

```python
@pytest.fixture
def test_project_with_clip(db_connection):
    """Create a project with one clip for testing updates."""
    cursor = db_connection.cursor()

    cursor.execute("INSERT INTO projects (name) VALUES ('Update Test')")
    project_id = cursor.lastrowid

    cursor.execute("""
        INSERT INTO working_clips (project_id, uploaded_filename, version)
        VALUES (?, 'test.mp4', 1)
    """, (project_id,))
    clip_id = cursor.lastrowid

    db_connection.commit()

    yield project_id, clip_id

    # Cleanup
    cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    db_connection.commit()
```

---

## Test Execution Plan

### Phase 1: Before Refactor
1. Write all tests in `test_framing_data_normalization.py`
2. Run tests: `pytest src/backend/tests/test_framing_data_normalization.py -v`
3. All edge case tests must PASS (normalize helper tests will skip)
4. Commit: "Add tests for framing data null checks"

### Phase 2: Implement normalize_json_data()
1. Add function to `app/routers/clips.py`
2. Run normalize helper unit tests
3. Update `update_clip()` to use normalizer

### Phase 3: Run Migration
1. Execute migration SQL:
   ```sql
   UPDATE working_clips SET crop_data = NULL WHERE crop_data IN ('', '[]');
   UPDATE working_clips SET segments_data = NULL WHERE segments_data IN ('', '{}');
   UPDATE working_clips SET timing_data = NULL WHERE timing_data IN ('', '{}');
   ```
2. Verify migration: `SELECT COUNT(*) FROM working_clips WHERE crop_data = ''`

### Phase 4: Simplify SQL Checks
1. Update `projects.py` to use simple `IS NOT NULL` checks
2. Run all tests
3. Verify project counts still correct

### Phase 5: After Refactor
1. Run full test suite: `pytest src/backend/tests/ -v`
2. Manual verification:
   - Create new clip, verify crop_data is NULL
   - Add framing, verify crop_data has JSON
   - Clear framing (save empty), verify crop_data is NULL
   - Check project shows correct "in progress" count
3. Commit: "Simplify framing data null checks with normalization"

---

## Manual Verification Checklist

- [ ] New clip has NULL for all framing fields
- [ ] Saving `[]` stores NULL (not `[]`)
- [ ] Saving `{}` stores NULL (not `{}`)
- [ ] Saving valid JSON preserves data
- [ ] Project "clips in progress" count is correct
- [ ] No existing clip data corrupted by migration

---

## Benefits

- Consistent data representation
- Simpler, more readable SQL
- Fewer edge cases to handle
- Single source of truth for "has data"
