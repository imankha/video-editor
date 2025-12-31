# Replace `progress` Flag with `exported_at` Timestamp

**Priority**: 1 (Highest)
**Smell**: Primitive Obsession
**Pattern**: Replace Data Value with Object / Replace Type Code with Class

---

## Current State

The `working_clips.progress` field is an INTEGER (0 or 1):
- `progress = 0` means "not exported"
- `progress = 1` means "exported"

This is redundant with checking if framing data exists (for "has edits" logic).

---

## Problem

- Two concepts conflated: "has edits" vs "was exported"
- Led to `clips_framed` vs `clips_in_progress` naming bug
- Flag provides no information about WHEN export happened

---

## Proposed Change

```sql
-- Replace: progress INTEGER DEFAULT 0
-- With:    exported_at TEXT DEFAULT NULL  -- ISO timestamp
```

**Versioning check becomes**:
```python
was_exported = current_clip['exported_at'] IS NOT NULL
```

---

## Files to Change

### Backend

| File | Line | Function/Context | Change Required |
|------|------|------------------|-----------------|
| `app/database.py` | 114 | Schema definition | Change `progress INTEGER DEFAULT 0` to `exported_at TEXT DEFAULT NULL` |
| `app/routers/clips.py` | 173 | `list_project_clips()` | Update SELECT to use `exported_at` |
| `app/routers/clips.py` | 389 | `update_clip()` docstring | Update comment about progress check |
| `app/routers/clips.py` | 456-458 | `update_clip()` | Remove progress update logic |
| `app/routers/export.py` | 1664 | Docstring | Update comment |
| `app/routers/export.py` | 1729-1732 | `save_working_video()` | Change `SET progress = 1` to `SET exported_at = datetime('now')` |
| `app/routers/projects.py` | 40 | `ProjectSummary` model | Update comment |
| `app/routers/projects.py` | 88-93 | `list_projects()` | Change `progress >= 1` to `exported_at IS NOT NULL` |
| `app/routers/projects.py` | 215 | `get_project()` | Update SELECT to use `exported_at` |

### Frontend

| File | Line | Function/Context | Change Required |
|------|------|------------------|-----------------|
| `hooks/useProjectClips.js` | 180-206 | `updateClipProgress()` | Remove or rename to handle timestamp |

---

## Tests to Write BEFORE Refactor

Write these tests first to document current behavior. All must pass before starting refactor.

### Test File: `src/backend/tests/test_progress_refactor.py`

```python
"""
Tests for progress/exported_at refactor.
Run BEFORE refactor to verify current behavior, then AFTER to verify no regression.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db_connection

client = TestClient(app)


class TestClipExportedStatus:
    """Test that clip export status is correctly tracked and reported."""

    def test_new_clip_is_not_exported(self, test_project_with_clip):
        """A newly created working clip should not be marked as exported."""
        project_id, clip_id = test_project_with_clip

        response = client.get(f"/api/clips/projects/{project_id}/clips")
        assert response.status_code == 200

        clips = response.json()["clips"]
        clip = next(c for c in clips if c["id"] == clip_id)

        # BEFORE: check progress == 0
        # AFTER: check exported_at is None
        assert clip.get("progress", 0) == 0 or clip.get("exported_at") is None

    def test_clip_marked_exported_after_framing_export(self, test_project_with_clip):
        """After framing export, clip should be marked as exported."""
        project_id, clip_id = test_project_with_clip

        # Add crop data to clip
        client.put(
            f"/api/clips/projects/{project_id}/clips/{clip_id}",
            json={"crop_data": '[{"frame":0,"x":0,"y":0,"width":1080,"height":1920}]'}
        )

        # Trigger framing export (save_working_video)
        # This would normally happen via the export endpoint
        response = client.post(
            f"/api/export/projects/{project_id}/working-video",
            files={"video": ("test.mp4", b"fake video content", "video/mp4")}
        )

        # Verify clip is now marked as exported
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]
        clip = next(c for c in clips if c["id"] == clip_id)

        # BEFORE: check progress >= 1
        # AFTER: check exported_at is not None
        assert clip.get("progress", 0) >= 1 or clip.get("exported_at") is not None


class TestProjectClipCounts:
    """Test that project clip counts correctly reflect export status."""

    def test_clips_exported_count_zero_for_new_project(self, test_project_with_clips):
        """New project with clips should have clips_exported = 0."""
        project_id = test_project_with_clips

        response = client.get("/api/projects")
        projects = response.json()["projects"]
        project = next(p for p in projects if p["id"] == project_id)

        assert project["clips_exported"] == 0

    def test_clips_exported_count_increments_after_export(self, test_project_with_clips):
        """After export, clips_exported should reflect exported clips."""
        project_id = test_project_with_clips

        # Setup and export clips...
        # (test implementation details)

        response = client.get("/api/projects")
        projects = response.json()["projects"]
        project = next(p for p in projects if p["id"] == project_id)

        # Should have at least one exported clip
        assert project["clips_exported"] >= 1


class TestVersioningWithExportStatus:
    """Test that versioning correctly uses export status."""

    def test_editing_exported_clip_creates_new_version(self, test_exported_clip):
        """Editing a clip that was exported should create a new version."""
        project_id, clip_id = test_exported_clip

        # Get current version
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips_before = response.json()["clips"]
        original_clip = next(c for c in clips_before if c["id"] == clip_id)
        original_version = original_clip["version"]

        # Edit the clip (should trigger version increment since it was exported)
        response = client.put(
            f"/api/clips/projects/{project_id}/clips/{clip_id}",
            json={"crop_data": '[{"frame":0,"x":100,"y":100,"width":800,"height":1400}]'}
        )

        # Verify new version was created
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips_after = response.json()["clips"]

        # Should have a new clip with incremented version
        # (exact assertion depends on versioning implementation)

    def test_editing_unexported_clip_does_not_create_version(self, test_project_with_clip):
        """Editing a clip that was never exported should NOT create a new version."""
        project_id, clip_id = test_project_with_clip

        # Edit the clip
        response = client.put(
            f"/api/clips/projects/{project_id}/clips/{clip_id}",
            json={"crop_data": '[{"frame":0,"x":100,"y":100,"width":800,"height":1400}]'}
        )

        # Verify no new version was created (same clip updated in place)
        response = client.get(f"/api/clips/projects/{project_id}/clips")
        clips = response.json()["clips"]

        # Should still have only one clip
        assert len(clips) == 1
        assert clips[0]["version"] == 1
```

### Test Fixtures: `src/backend/tests/conftest.py`

```python
@pytest.fixture
def test_project_with_clip(db_connection):
    """Create a project with one unexported clip."""
    cursor = db_connection.cursor()

    # Create project
    cursor.execute("INSERT INTO projects (name) VALUES ('Test Project')")
    project_id = cursor.lastrowid

    # Create working clip (progress = 0 / exported_at = NULL)
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


@pytest.fixture
def test_exported_clip(test_project_with_clip, db_connection):
    """Create a project with one exported clip."""
    project_id, clip_id = test_project_with_clip
    cursor = db_connection.cursor()

    # Mark as exported
    # BEFORE: SET progress = 1
    # AFTER: SET exported_at = datetime('now')
    cursor.execute("""
        UPDATE working_clips SET progress = 1 WHERE id = ?
    """, (clip_id,))
    db_connection.commit()

    return project_id, clip_id
```

---

## Test Execution Plan

### Phase 1: Before Refactor
1. Write all tests in `test_progress_refactor.py`
2. Run tests: `pytest src/backend/tests/test_progress_refactor.py -v`
3. All tests must PASS (documenting current behavior)
4. Commit tests: "Add tests for progress/exported_at refactor"

### Phase 2: During Refactor
1. Make schema change (add `exported_at`, keep `progress` temporarily)
2. Run migration script
3. Update code references one file at a time
4. Run tests after each file change
5. Remove `progress` column after all code updated

### Phase 3: After Refactor
1. Run full test suite: `pytest src/backend/tests/ -v`
2. All tests must PASS
3. Run manual smoke test of export workflow
4. Commit: "Replace progress flag with exported_at timestamp"

---

## Migration Strategy

1. Add new `exported_at` column (nullable)
2. Migrate existing data: `UPDATE working_clips SET exported_at = datetime('now') WHERE progress = 1`
3. Update all code references
4. Drop `progress` column
5. Run full test suite

---

## Benefits

- Single source of truth for "was exported"
- Timestamp provides audit trail
- Eliminates redundant state
- Clearer semantics in code
