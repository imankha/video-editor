# T1180: Binary Data Format for JSON Columns

**Status:** TODO
**Impact:** 3
**Complexity:** 4
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

Several SQLite columns store large JSON blobs: `crop_data`, `timing_data`, `segments_data`, `highlights_data`, `input_data`. These are parsed by both Python (`json.loads`) and TypeScript (`JSON.parse`). JSON is text-based and verbose — repeated keys, quoted strings, decimal numbers all inflate size.

Since profile.sqlite is uploaded to R2 on every write request, smaller DB = faster sync. JSON columns are a significant portion of DB size for active users.

## Research: Format Options

### MessagePack (recommended)

- **What:** Binary JSON-compatible format. No schemas, no code generation. Drop-in replacement for JSON.parse/JSON.stringify.
- **Size:** ~30-50% smaller than JSON for typical structured data (numbers stored as binary, no key quoting, compact type markers).
- **Libraries:** Python `msgpack` (C extension, very fast), JS `@msgpack/msgpack` (pure JS, well-maintained).
- **Migration:** Can be done column-by-column. Each column gets a `_format` flag or we use a magic byte prefix to distinguish JSON vs msgpack.
- **Pros:** Zero schema overhead, both languages have mature libraries, handles all JSON types natively.
- **Cons:** Not human-readable in DB browser. Slightly more complex debugging.

### Protobuf / FlatBuffers

- **What:** Schema-defined binary formats. Require `.proto` files and code generation.
- **Size:** ~50-70% smaller than JSON (field tags instead of names, varint encoding).
- **Pros:** Maximum compression, type safety at the schema level.
- **Cons:** Schema files to maintain, code generation step in build, migration complexity, overkill for our use case where data shapes change per feature.

### CBOR

- **What:** RFC 7049 binary format, similar to MessagePack.
- **Size:** Similar to MessagePack (~30-50% smaller).
- **Cons:** Less ecosystem support than MessagePack in JS/Python.

## Recommendation

**MessagePack** is the right fit:
- No schema files or code generation (matches "doesn't add much complexity")
- Both Python and TypeScript parse these columns extensively — msgpack has mature, fast libraries for both
- One-shot migration: read JSON, write msgpack, flag the column
- Fallback: can detect format by first byte (JSON starts with `{` or `[`, msgpack uses type markers)

## Implementation Sketch

### 1. Add helpers

```python
# backend: app/utils/encoding.py
import msgpack, json

def encode_data(data: dict) -> bytes:
    return msgpack.packb(data, use_bin_type=True)

def decode_data(raw: bytes | str) -> dict:
    if isinstance(raw, str) or (isinstance(raw, bytes) and raw[0:1] in (b'{', b'[')):
        return json.loads(raw)
    return msgpack.unpackb(raw, raw=False)
```

```typescript
// frontend: src/utils/encoding.ts
import { encode, decode } from '@msgpack/msgpack';

export function decodeData(raw: ArrayBuffer | string): any {
  if (typeof raw === 'string') return JSON.parse(raw);
  return decode(raw);
}
```

### 2. Migrate column-by-column

Start with the largest columns (`crop_data`, `segments_data`). Each migration:
1. Read all rows
2. JSON.parse → msgpack.pack → UPDATE
3. After all rows migrated, new writes use msgpack

### 3. Backward compatibility

Use first-byte detection (no schema version needed):
- Byte `0x7B` (`{`) or `0x5B` (`[`) → JSON, parse with json.loads
- Anything else → msgpack, parse with msgpack.unpackb

This means old data works without migration — migration can run lazily or in cleanup.

## Who Parses These Columns

Both sides parse extensively:

**Python (json.loads):**
- `clips.py` — crop_data, timing_data, segments_data
- `projects.py` — crop_data, timing_data
- `framing.py` — crop_data
- `overlay.py` — highlights_data, input_data
- `multi_clip.py` — crop_data, timing_data, segments_data

**TypeScript (JSON.parse):**
- All of the above via API responses, parsed in stores/hooks

## Context

### Relevant Files
- `src/backend/app/routers/clips.py` — reads/writes crop_data, timing_data, segments_data
- `src/backend/app/routers/projects.py` — reads crop_data, timing_data
- `src/backend/app/routers/framing.py` — reads crop_data
- `src/backend/app/routers/overlay.py` — reads highlights_data, input_data
- `src/backend/app/services/multi_clip.py` — reads crop_data, timing_data, segments_data
- `src/backend/app/services/project_archive.py` — cleanup functions

### Related Tasks
- T1020: Fast R2 sync (smaller DB = faster upload)
- T1160: Clean up unused DB rows (complementary size reduction)
- T1170: Size-based VACUUM on init (complementary)

## Acceptance Criteria

- [ ] encode/decode helpers in both Python and TypeScript
- [ ] Backward-compatible: auto-detects JSON vs msgpack by first byte
- [ ] At least crop_data and segments_data migrated to msgpack
- [ ] DB size reduction measured and logged
- [ ] No change to API response format (frontend receives parsed objects)
- [ ] Migration can run lazily (on read) or eagerly (in cleanup)
