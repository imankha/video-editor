# Extract Version Filtering SQL to Reusable View/CTE

**Priority**: 2
**Smell**: Duplicated Code
**Pattern**: Extract Method / Consolidate Duplicate Conditional Fragments

---

## Current State

The "latest version per clip" window function appears in 6 places:

```sql
SELECT id FROM (
    SELECT wc.id, ROW_NUMBER() OVER (
        PARTITION BY COALESCE(rc.end_time, wc.uploaded_filename)
        ORDER BY wc.version DESC
    ) as rn
    FROM working_clips wc
    LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
    WHERE wc.project_id = ?
) WHERE rn = 1
```

---

## Problem

- Same complex SQL duplicated across multiple files
- If logic changes, must update 6+ places
- Easy to introduce inconsistencies
- Hard to understand queries

---

## Current Locations

| File | Line | Function | Purpose |
|------|------|----------|---------|
| `app/routers/clips.py` | 191-196 | `list_project_clips()` | Get latest clips for listing |
| `app/routers/projects.py` | 103-108 | `list_projects()` | Count clips per project |
| `app/routers/projects.py` | 223-228 | `discard_uncommitted_changes()` | Find clips to delete |
| `app/routers/export.py` | 1735-1740 | `save_working_video()` | Update progress on latest clips |
| `app/routers/downloads.py` | 59-64 | `list_downloads()` | Get latest final videos |
| `app/routers/downloads.py` | 219-224 | `get_download_count()` | Count latest final videos |

---

## Proposed Change

### Option A: Database View

```sql
CREATE VIEW latest_working_clips AS
SELECT wc.* FROM working_clips wc
LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
WHERE wc.id IN (
    SELECT id FROM (
        SELECT wc2.id, ROW_NUMBER() OVER (
            PARTITION BY COALESCE(rc2.end_time, wc2.uploaded_filename)
            ORDER BY wc2.version DESC
        ) as rn
        FROM working_clips wc2
        LEFT JOIN raw_clips rc2 ON wc2.raw_clip_id = rc2.id
    ) WHERE rn = 1
);
```

### Option B: Python Helper Function

```python
# In app/database.py or new app/queries.py

def latest_clips_subquery(table_alias: str = "wc", project_filter: bool = True) -> str:
    """
    Returns SQL subquery for filtering to latest version per clip identity.

    Args:
        table_alias: Alias for working_clips table
        project_filter: Whether to include project_id = ? filter

    Returns:
        SQL string for use in WHERE ... id IN (...)
    """
    project_clause = f"WHERE {table_alias}2.project_id = ?" if project_filter else ""
    return f"""
        SELECT id FROM (
            SELECT {table_alias}2.id, ROW_NUMBER() OVER (
                PARTITION BY COALESCE(rc2.end_time, {table_alias}2.uploaded_filename)
                ORDER BY {table_alias}2.version DESC
            ) as rn
            FROM working_clips {table_alias}2
            LEFT JOIN raw_clips rc2 ON {table_alias}2.raw_clip_id = rc2.id
            {project_clause}
        ) WHERE rn = 1
    """
```

---

## Files to Update After Refactor

| File | Line | Current Code | New Code |
|------|------|--------------|----------|
| `app/routers/clips.py` | 191-196 | Inline SQL | `WHERE wc.id IN ({latest_clips_subquery()})` |
| `app/routers/projects.py` | 103-108 | Inline SQL | Use helper or view |
| `app/routers/projects.py` | 223-228 | Inline SQL | Use helper or view |
| `app/routers/export.py` | 1735-1740 | Inline SQL | Use helper or view |
| `app/routers/downloads.py` | 59-64 | Inline SQL | Use helper or view |
| `app/routers/downloads.py` | 219-224 | `get_download_count()` | Use helper or view |

---

## Tests to Write BEFORE Refactor

Write these tests first to document current behavior. All must pass before AND after refactor.

### Test File: `src/backend/tests/test_version_filtering.py`

```python
"""
Tests for version filtering behavior.
Run BEFORE refactor to verify current behavior, then AFTER to verify no regression.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection

client = TestClient(app)


class TestLatestVersionFiltering:
    """Test that only latest versions are returned across all endpoints."""

    def test_list_clips_returns_only_latest_version(self, project_with_versioned_clips):
        """GET /clips should return only the latest version of each clip."""
        project_id, clip_identities = project_with_versioned_clips

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        assert response.status_code == 200

        clips = response.json()["clips"]

        # Should have one clip per identity, not one per version
        assert len(clips) == len(clip_identities)

        # Each returned clip should be the highest version for its identity
        for clip in clips:
            identity = clip.get("raw_clip_id") or clip.get("uploaded_filename")
            expected_version = clip_identities[identity]["latest_version"]
            assert clip["version"] == expected_version

    def test_project_clip_count_counts_unique_clips(self, project_with_versioned_clips):
        """GET /projects should count unique clips, not total versions."""
        project_id, clip_identities = project_with_versioned_clips

        response = client.get("/api/projects")
        projects = response.json()["projects"]
        project = next(p for p in projects if p["id"] == project_id)

        # clip_count should be number of unique clips, not total versions
        assert project["clip_count"] == len(clip_identities)

    def test_export_updates_only_latest_versions(self, project_with_versioned_clips):
        """Framing export should only update latest version clips."""
        project_id, clip_identities = project_with_versioned_clips

        # Trigger export
        # (implementation depends on export endpoint setup)

        # Verify only latest versions were marked as exported
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, version, progress FROM working_clips
                WHERE project_id = ?
                ORDER BY version DESC
            """, (project_id,))
            rows = cursor.fetchall()

            # Group by identity and check only latest has progress=1
            # (test implementation details)

    def test_downloads_list_returns_only_latest_final_videos(self, project_with_versioned_finals):
        """GET /downloads should return only latest final video per project."""
        project_id, versions_created = project_with_versioned_finals

        response = client.get("/api/downloads")
        assert response.status_code == 200

        downloads = response.json()["downloads"]

        # Should have only one download per project
        project_downloads = [d for d in downloads if d["project_id"] == project_id]
        assert len(project_downloads) == 1

        # Should be the latest version
        assert project_downloads[0]["version"] == versions_created

    def test_downloads_count_matches_list_length(self, project_with_versioned_finals):
        """GET /downloads/count should match length of GET /downloads."""
        response_list = client.get("/api/downloads")
        response_count = client.get("/api/downloads/count")

        list_count = len(response_list.json()["downloads"])
        api_count = response_count.json()["count"]

        assert list_count == api_count


class TestVersionFilteringEdgeCases:
    """Test edge cases in version filtering."""

    def test_single_version_clip_is_returned(self, project_with_single_clip):
        """A clip with only version 1 should be returned."""
        project_id, clip_id = project_with_single_clip

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        assert len(clips) == 1
        assert clips[0]["id"] == clip_id
        assert clips[0]["version"] == 1

    def test_mixed_raw_and_uploaded_clips(self, project_with_mixed_clips):
        """Version filtering works for both raw_clip-based and uploaded clips."""
        project_id, expected_clips = project_with_mixed_clips

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        assert len(clips) == expected_clips

    def test_empty_project_returns_empty_list(self, empty_project):
        """Project with no clips should return empty list, not error."""
        project_id = empty_project

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        assert response.status_code == 200
        assert response.json()["clips"] == []


class TestDiscardUncommitted:
    """Test that discard_uncommitted correctly identifies non-latest versions."""

    def test_discard_removes_only_uncommitted_versions(self, project_with_uncommitted_changes):
        """Discard should remove versions newer than last export."""
        project_id, exported_version, uncommitted_version = project_with_uncommitted_changes

        # Call discard endpoint
        response = client.post(f"/api/projects/{project_id}/discard-uncommitted")
        assert response.status_code == 200

        # Verify uncommitted version was removed
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        for clip in clips:
            assert clip["version"] <= exported_version
```

### Test Fixtures: `src/backend/tests/conftest.py`

```python
@pytest.fixture
def project_with_versioned_clips(db_connection):
    """Create a project with multiple versions of the same clip."""
    cursor = db_connection.cursor()

    # Create project
    cursor.execute("INSERT INTO projects (name) VALUES ('Version Test Project')")
    project_id = cursor.lastrowid

    # Create raw clip for identity
    cursor.execute("""
        INSERT INTO raw_clips (game_id, filename, end_time)
        VALUES (1, 'test.mp4', 12345)
    """)
    raw_clip_id = cursor.lastrowid

    # Create multiple versions of same clip (same raw_clip_id = same identity)
    for version in [1, 2, 3]:
        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, version, progress)
            VALUES (?, ?, ?, ?)
        """, (project_id, raw_clip_id, version, 1 if version < 3 else 0))

    db_connection.commit()

    clip_identities = {
        raw_clip_id: {"latest_version": 3}
    }

    yield project_id, clip_identities

    # Cleanup
    cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
    cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    db_connection.commit()


@pytest.fixture
def project_with_versioned_finals(db_connection):
    """Create a project with multiple final video versions."""
    cursor = db_connection.cursor()

    # Create project
    cursor.execute("INSERT INTO projects (name) VALUES ('Final Version Test')")
    project_id = cursor.lastrowid

    # Create multiple final video versions
    for version in [1, 2, 3]:
        cursor.execute("""
            INSERT INTO final_videos (project_id, filename, version)
            VALUES (?, ?, ?)
        """, (project_id, f"final_v{version}.mp4", version))

    db_connection.commit()

    yield project_id, 3  # project_id, latest_version

    # Cleanup
    cursor.execute("DELETE FROM final_videos WHERE project_id = ?", (project_id,))
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    db_connection.commit()
```

---

## Test Execution Plan

### Phase 1: Before Refactor
1. Write all tests in `test_version_filtering.py`
2. Run tests: `pytest src/backend/tests/test_version_filtering.py -v`
3. All tests must PASS
4. Commit: "Add tests for version filtering behavior"

### Phase 2: Implement Helper
1. Create `app/queries.py` with `latest_clips_subquery()` function
2. Write unit tests for the helper function itself:
   ```python
   def test_latest_clips_subquery_generates_valid_sql():
       sql = latest_clips_subquery()
       assert "ROW_NUMBER()" in sql
       assert "PARTITION BY" in sql
       assert "WHERE rn = 1" in sql
   ```
3. Run tests

### Phase 3: Replace Inline SQL
1. Update each file one at a time
2. Run `test_version_filtering.py` after each file
3. Order of updates:
   - `clips.py` (most used)
   - `projects.py:list_projects()`
   - `projects.py:discard_uncommitted_changes()`
   - `export.py`
   - `downloads.py:list_downloads()`
   - `downloads.py:get_download_count()`

### Phase 4: After Refactor
1. Run full test suite: `pytest src/backend/tests/ -v`
2. Verify no duplicate SQL remains: `grep -r "ROW_NUMBER.*PARTITION BY" app/routers/`
3. Commit: "Extract version filtering SQL to reusable helper"

---

## Benefits

- Single place to fix version filtering bugs
- Easier to understand queries
- Consistent behavior across all endpoints
- Reduces code duplication by ~100 lines
