# Refactoring Backlog

Ordered by impact. Each item references Fowler's refactoring patterns where applicable.

---

## 1. Replace `progress` Flag with `exported_at` Timestamp

**Smell**: Primitive Obsession
**Pattern**: Replace Data Value with Object / Replace Type Code with Class

**Current State**:
- `working_clips.progress` is INTEGER (0 or 1)
- `progress = 0` means "not exported", `progress = 1` means "exported"
- Redundant with checking if framing data exists (for "has edits" logic)

**Problem**:
- Two concepts conflated: "has edits" vs "was exported"
- Led to `clips_framed` vs `clips_in_progress` naming bug
- Flag provides no information about WHEN export happened

**Proposed Change**:
```sql
-- Replace: progress INTEGER DEFAULT 0
-- With:    exported_at TEXT DEFAULT NULL  -- ISO timestamp
```

**Versioning check becomes**:
```python
was_exported = current_clip['exported_at'] IS NOT NULL
```

**Benefits**:
- Single source of truth for "was exported"
- Timestamp provides audit trail
- Eliminates redundant state

**Files to Change**:
- `database.py` - schema migration
- `clips.py` - versioning logic
- `export.py` - set `exported_at = datetime.now()`
- `projects.py` - queries using `progress >= 1`

---

## 2. Extract Version Filtering SQL to Reusable View/CTE

**Smell**: Duplicated Code
**Pattern**: Extract Method / Consolidate Duplicate Conditional Fragments

**Current State**:
The "latest version" window function appears in 5+ places:
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

**Locations**:
- `clips.py:185-200` - list_project_clips
- `projects.py:101-111` - clip counts
- `export.py:1733-1741` - framing export
- `projects.py:373-377` - discard uncommitted

**Proposed Change**:
Create a database view or helper function:
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

Or Python helper:
```python
def get_latest_clips_subquery(project_id_param: str = "?") -> str:
    return f"""..."""
```

**Benefits**:
- Single place to fix version filtering bugs
- Easier to understand queries
- Consistent behavior across all endpoints

---

## 3. Consolidate Clip Identity Logic

**Smell**: Shotgun Surgery
**Pattern**: Move Method / Extract Class

**Current State**:
Clip identity (which clips are "the same" across versions) uses `COALESCE(rc.end_time, wc.uploaded_filename)`. This logic is spread across:
- `clips.py` - version numbering
- `projects.py` - counting
- `export.py` - progress updates

**Problem**:
- If identity logic changes, must update multiple files
- Easy to get wrong (we had bugs with `raw_clip_id` vs `end_time`)

**Proposed Change**:
Add `clip_identity_key` column computed on insert:
```sql
ALTER TABLE working_clips ADD COLUMN clip_identity_key TEXT;
-- Populated as: COALESCE(raw_clips.end_time, uploaded_filename)
```

Or create a helper:
```python
def get_clip_identity_key(raw_clip_id: int, uploaded_filename: str, cursor) -> str:
    if raw_clip_id:
        cursor.execute("SELECT end_time FROM raw_clips WHERE id = ?", (raw_clip_id,))
        return str(cursor.fetchone()['end_time'])
    return uploaded_filename
```

---

## 4. Remove Unused `updateClipProgress` Frontend Function

**Smell**: Dead Code / Speculative Generality
**Pattern**: Remove Dead Code

**Current State**:
`useProjectClips.js:180-206` exports `updateClipProgress()` which calls `PUT` with `{ progress }`.

**Problem**:
- Frontend never needs to set progress directly
- Progress is set by backend during export
- Function exists but has no callers (verify with grep)

**Verification**:
```bash
grep -r "updateClipProgress" src/frontend --include="*.js" --include="*.jsx"
```

If only defined in hook and not called elsewhere, remove it.

---

## 5. Simplify Framing Data Null Checks

**Smell**: Primitive Obsession / Duplicated Code
**Pattern**: Introduce Null Object / Extract Method

**Current State**:
Multiple places check for "has framing data":
```python
(crop_data IS NOT NULL AND crop_data != '' AND crop_data != '[]') OR
(segments_data IS NOT NULL AND segments_data != '' AND segments_data != '{}') OR
(timing_data IS NOT NULL AND timing_data != '' AND timing_data != '{}')
```

**Problem**:
- Repeated in projects.py and potentially elsewhere
- Empty string vs null vs empty JSON all mean "no data"
- Easy to miss one case

**Proposed Change**:
Standardize on NULL for "no data":
- Never store empty string or empty JSON
- Update save logic to convert `''`, `'[]'`, `'{}'` to NULL
- Simplify checks to just `IS NOT NULL`

---

## Notes

- Refactors should be done after current bugs are fixed
- Each refactor should be a separate PR with tests
- Run full test suite after each change
