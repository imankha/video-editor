# T2870: Migrate SQLite JSON Columns to MsgPack

**Status:** TESTING
**Depends on:** None (can run independently; should run after T2800 which added `tagged_teammates`)

## Problem

The codebase has two serialization formats in SQLite: binary columns (`crop_data`, `timing_data`, `segments_data`, `highlights_data`) use msgpack via `encode_data()`/`decode_data()`, while text columns (`tags`, `tagged_teammates`, `default_highlight_regions`, `parts_json`, `rating_counts`, `text_overlays`) use `json.dumps()`/`json.loads()`. This inconsistency means two serialization paths, two mental models, and missed (minor) size savings.

No SQLite JSON functions (`json_each`, `json_extract`, etc.) are used anywhere in the codebase -- all JSON parsing happens in Python. There is no technical reason to keep JSON.

## Solution

Migrate all JSON TEXT columns to msgpack BLOB columns, reusing the existing `encode_data()`/`decode_data()` helpers from `app/utils/encoding.py`.

### Columns to Migrate

| Table | Column | Typical Data | Current Type |
|-------|--------|-------------|--------------|
| raw_clips | tags | `["brilliant", "pass"]` | TEXT (json) |
| raw_clips | tagged_teammates | `["Jake", "Player 7"]` | TEXT (json) |
| raw_clips | default_highlight_regions | Large array of region objects with keyframes | TEXT (json) |
| pending_uploads | parts_json | Array of `{part_number, etag}` objects | TEXT (json) |
| final_videos | rating_counts | `{"brilliant": 5, "good": 3, ...}` | TEXT (json) |
| working_videos | text_overlays | Array of text overlay objects | TEXT (json) |

### Migration Strategy

Follow the same idempotent migration pattern used throughout `database.py`:

1. For each column, check if it contains TEXT (JSON) or BLOB (msgpack) data
2. If TEXT: decode with `json.loads()`, re-encode with `encode_data()`, update in-place
3. The column type stays TEXT in SQLite (SQLite is dynamically typed -- storing bytes in a TEXT column works fine, same as the existing msgpack columns)
4. Add a migration marker to avoid re-running

**Detection heuristic:** msgpack bytes start with specific type markers (0x90-0x9f for small arrays, 0x80-0x8f for small maps, 0xdc/0xdd for larger arrays). JSON strings start with `[` or `{` (0x5b or 0x7b). Check the first byte to determine format. The existing `decode_data()` function already handles this -- see `encoding.py`.

### Code Changes

1. **All `json.dumps()` calls for these columns** -> `encode_data()`
2. **All `json.loads()` calls for these columns** -> `decode_data()`
3. **Migration in `database.py`** -> one-time conversion of existing rows
4. **API response serialization** -> `decode_data()` returns Python objects, which FastAPI serializes to JSON for the API response (no change to API contracts)

### What Does NOT Change

- API request/response format (still JSON over HTTP)
- The existing msgpack columns (`crop_data`, `timing_data`, `segments_data`, `highlights_data`)
- `user_settings.settings_json` -- this is a single-row config blob, keep as JSON for debuggability
- Archive format (already msgpack)

## Key Patterns

- `encode_data()` at `app/utils/encoding.py:8` -- `msgpack.packb(data, use_bin_type=True)`
- `decode_data()` at `app/utils/encoding.py:20` -- `msgpack.unpackb(raw, raw=False)`
- `normalize_and_encode()` at `app/schemas.py:93` -- normalizes empty values + encodes (used by framing data columns)
- Existing migration script reference: `scripts/migrate_msgpack.py` (T1180 migration)
- Import check after edits: `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`

## Test Scope

- Backend tests: save/load roundtrip for each migrated column
- Backend tests: migration converts existing JSON rows to msgpack
- Backend tests: API responses unchanged (still return JSON over HTTP)
- Verify existing tests still pass (especially `test_encoding.py`, `test_t1180_roundtrip.py`)

## Files Affected

- `src/backend/app/database.py` -- migration block
- `src/backend/app/routers/clips.py` -- `tags`, `tagged_teammates`, `default_highlight_regions`
- `src/backend/app/routers/games_upload.py` -- `parts_json`
- `src/backend/app/routers/downloads.py` -- `rating_counts`
- `src/backend/app/services/export/overlay.py` -- `default_highlight_regions`
- `src/backend/tests/test_teammate_tags.py` -- update assertions for msgpack storage

## Estimate

~150 LOC changes, ~50 LOC tests
