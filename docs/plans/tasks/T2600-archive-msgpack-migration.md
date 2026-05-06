# T2600: Archive Format Migration (JSON → msgpack)

## Problem

Project archives in R2 are stored as JSON. Binary columns (crop_data, segments_data, highlights_data, timing_data) go through a lossy roundtrip:

```
DB (msgpack bytes) → decode to Python objects → JSON string → parse to Python objects → re-encode to msgpack bytes
```

This roundtrip caused data loss for a real user: archives created before the DB msgpack migration stored binary columns as JSON strings nested inside JSON. On restore, `encode_data(string)` produced msgpack-of-string instead of msgpack-of-list, breaking the frontend.

## Solution

Store archives as msgpack instead of JSON. Binary columns stay as raw msgpack bytes end-to-end — no decode/re-encode:

```
DB (msgpack bytes) → archive (msgpack bytes) → DB (msgpack bytes)
```

## Scope

**Stack Layers:** Backend
**Files Affected:** ~2 files
**LOC Estimate:** ~40 lines
**Test Scope:** Backend

## Implementation

### Part 1: Convert archive format to msgpack

**File: `app/services/project_archive.py`**

1. Change `archive_project()`:
   - Stop decoding binary columns in `_row_to_dict()` — keep them as raw bytes
   - Serialize the archive dict with `msgpack.packb()` instead of `json.dumps()`
   - Upload as `application/octet-stream` instead of `application/json`
   - Change file extension from `.json` to `.msgpack` in `_get_archive_r2_key()`

2. Change `restore_project()`:
   - Deserialize with `msgpack.unpackb()` instead of `json.loads()`
   - Binary columns are already msgpack bytes — write directly to DB, no `encode_data()` needed

3. Change `is_project_archived()`:
   - Check for `.msgpack` extension

### Part 2: Migrate all live user archives

**New script: `scripts/migrate_archives_to_msgpack.py`**

For every user across all environments (staging + prod):

1. List all `archive/*.json` files in R2
2. For each archive:
   - Download JSON
   - Parse with `json.loads()`
   - For each binary column value: if it's a Python object (list/dict), `encode_data()` it to msgpack bytes. If it's already a string (legacy), `json.loads()` first then `encode_data()`.
   - Serialize entire archive with `msgpack.packb()`
   - Upload as `archive/{project_id}.msgpack`
   - Delete old `archive/{project_id}.json`
3. Log every migration for audit

**Run order:**
1. Deploy Part 1 code with backward compat: `restore_project()` tries `.msgpack` first, falls back to `.json`
2. Run migration script on staging, verify with tests
3. Run migration script on prod
4. Remove `.json` fallback in next deploy

### Part 3: Remove JSON fallback

After confirming all archives are migrated:
- Remove JSON fallback from `restore_project()`
- Remove JSON fallback from `is_project_archived()`

## Risks

- **Data loss during migration**: Mitigated by not deleting `.json` until `.msgpack` is confirmed uploaded
- **Partial deploy**: Mitigated by backward-compat fallback in Part 1
- **Archive version**: Bump `ARCHIVE_VERSION` to 2 for msgpack format
