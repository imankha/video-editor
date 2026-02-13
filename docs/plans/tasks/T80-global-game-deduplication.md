# T80: Global Game Deduplication + 4GB Upload Support

**Status:** TODO
**Priority:** CRITICAL - Blocks deployment
**Impact:** 9
**Complexity:** 8
**Created:** 2026-02-13
**Updated:** 2026-02-13

## Problem

1. **Duplicate storage**: Same game video uploaded by multiple users is stored multiple times
2. **4GB limit**: Current upload flow doesn't support large game videos (4GB+)
3. **Per-user storage model**: No deduplication possible

---

## Note: T85 Follows This Task

After T80, **T85 (Multi-Athlete Profiles)** will:
- Add `{user_id}/user.sqlite` for user-level config
- Move per-user database to `{user_id}/athletes/{athlete_id}/database.sqlite`
- Update sync middleware for multiple databases

**Implications for T80:**
- `user_games` table will later become per-athlete (no change needed now)
- Path helpers should use functions (not hardcoded strings) for easier T85 updates
- Don't add new user-level config to `database.sqlite` - it will move

## Solution

Global deduplicated game storage with backend-controlled linking. **No global database** - use R2 key existence checks.

**Key Principle:** Client NEVER decides ownership. Backend is sole authority.

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Global database | **None** | Use `r2_head_object()` for existence check |
| Hash algorithm | **BLAKE3** | Faster than SHA256, lazy-load WASM |
| Metadata storage | **Per-user `user_games` table** | Avoids concurrency issues |
| Hash verification | **Trust client + verify size** | Hash is never leaked to users |
| Race condition | **Accept rare duplicate upload** | Simple, no corruption |
| Reference counting | **R2 object metadata** | Delete when `ref_count` hits 0 |
| URL expiry | **4 hours** | Enough for 4GB at slow speeds |
| Migration | **Script for user "a" only** | Delete other test users |

---

## Storage Structure

```
R2: reel-ballers-users/
├── games/                              # Global deduplicated
│   └── {blake3_hash}.mp4               # Just hash, no filename
│       └── [metadata: ref_count, original_filename, duration, etc.]
│
└── {user_id}/                          # Per-user
    ├── database.sqlite                 # Has user_games, pending_uploads
    ├── raw_clips/...
    └── working_videos/...
```

---

## Database Schema

### Per-User Database (Modified)

```sql
-- Replace old games table with user_games
CREATE TABLE user_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blake3_hash TEXT NOT NULL UNIQUE,   -- Global game identifier
    original_filename TEXT NOT NULL,    -- Original upload name
    display_name TEXT,                  -- User's custom name (nullable)
    file_size INTEGER NOT NULL,
    duration REAL,
    width INTEGER,
    height INTEGER,
    fps REAL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Track in-progress uploads
CREATE TABLE pending_uploads (
    id TEXT PRIMARY KEY,                -- Upload session ID
    blake3_hash TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    r2_upload_id TEXT NOT NULL,         -- R2 multipart upload ID
    parts_json TEXT,                    -- JSON array of completed parts
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### R2 Object Metadata

Stored on each `games/{hash}.mp4` object:

```json
{
  "ref_count": 3,
  "original_filename": "game1.mp4",
  "duration": 1234.5,
  "width": 1920,
  "height": 1080,
  "fps": 60.0,
  "created_at": "2026-02-13T12:00:00Z"
}
```

---

## API Endpoints

### POST /api/games/prepare-upload

Client calls after computing BLAKE3 hash.

**Request:**
```json
{
  "blake3_hash": "a1b2c3d4e5f6...",
  "file_size": 4123981234,
  "original_filename": "game1.mp4"
}
```

**Backend Logic:**
```python
# 1. Validate inputs
validate_blake3_format(blake3_hash)
validate_file_size(file_size)

# 2. Check if game already exists in R2
r2_key = f"games/{blake3_hash}.mp4"
exists = r2_head_object(r2_key)

if exists:
    # 3a. Check if user already has this game
    existing = db.query("SELECT id FROM user_games WHERE blake3_hash = ?", blake3_hash)
    if existing:
        return {"status": "already_owned", "game_id": existing.id}

    # 3b. Link to user's account
    metadata = get_r2_object_metadata(r2_key)
    game_id = db.insert("INSERT INTO user_games ...", metadata)

    # 3c. Increment ref_count
    increment_ref_count(r2_key)

    return {"status": "linked", "game_id": game_id}

else:
    # 4. Create multipart upload
    upload_id = r2_create_multipart_upload(r2_key)
    session_id = generate_session_id()

    # 5. Store pending upload in user's DB
    db.insert("INSERT INTO pending_uploads ...", session_id, blake3_hash, upload_id)

    # 6. Generate presigned URLs for parts (4 hour expiry)
    parts = generate_part_urls(r2_key, upload_id, file_size, part_size=100MB)

    return {
        "status": "upload_required",
        "upload_session_id": session_id,
        "parts": parts
    }
```

**Response (Already Owned):**
```json
{
  "status": "already_owned",
  "game_id": 123
}
```

**Response (Linked):**
```json
{
  "status": "linked",
  "game_id": 124,
  "message": "Game already exists, linked to your account"
}
```

**Response (Upload Required):**
```json
{
  "status": "upload_required",
  "upload_session_id": "sess_abc123",
  "parts": [
    {
      "part_number": 1,
      "presigned_url": "https://...",
      "start_byte": 0,
      "end_byte": 104857599
    }
  ]
}
```

### POST /api/games/finalize-upload

Client calls after uploading all parts.

**Request:**
```json
{
  "upload_session_id": "sess_abc123",
  "parts": [
    {"part_number": 1, "etag": "\"abc123\""},
    {"part_number": 2, "etag": "\"def456\""}
  ]
}
```

**Backend Logic:**
```python
# 1. Get pending upload from user's DB
pending = db.query("SELECT * FROM pending_uploads WHERE id = ?", session_id)
if not pending:
    raise HTTPException(404, "Upload session not found")

r2_key = f"games/{pending.blake3_hash}.mp4"

# 2. Complete multipart upload in R2
r2_complete_multipart_upload(r2_key, pending.r2_upload_id, parts)

# 3. Verify file size matches
obj = r2_head_object(r2_key)
if obj.content_length != pending.file_size:
    r2_delete_object(r2_key)
    raise HTTPException(400, "File size mismatch")

# 4. Extract video metadata (ffprobe)
metadata = extract_video_metadata(r2_key)

# 5. Set R2 object metadata (ref_count = 1)
r2_set_object_metadata(r2_key, {
    "ref_count": 1,
    "original_filename": pending.original_filename,
    **metadata
})

# 6. Insert into user's database
game_id = db.insert("INSERT INTO user_games ...", pending, metadata)

# 7. Delete pending upload record
db.execute("DELETE FROM pending_uploads WHERE id = ?", session_id)

return {"status": "success", "game_id": game_id}
```

### DELETE /api/games/{game_id}

User deletes a game from their library.

**Backend Logic:**
```python
# 1. Get game from user's DB
game = db.query("SELECT * FROM user_games WHERE id = ?", game_id)
if not game:
    raise HTTPException(404)

r2_key = f"games/{game.blake3_hash}.mp4"

# 2. Decrement ref_count in R2 metadata
new_count = decrement_ref_count(r2_key)

# 3. If ref_count == 0, delete the actual file
if new_count == 0:
    r2_delete_object(r2_key)

# 4. Remove from user's database
db.execute("DELETE FROM user_games WHERE id = ?", game_id)

# 5. Also delete any clips/projects using this game?
# (Or just orphan them - decide based on UX)

return {"status": "deleted"}
```

---

## Frontend Implementation

### BLAKE3 Hashing (Web Worker)

```javascript
// workers/hashWorker.js
import { blake3 } from '@noble/hashes/blake3';

self.onmessage = async (e) => {
  const { file } = e.data;
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks

  const hasher = blake3.create({});
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await chunk.arrayBuffer();
    hasher.update(new Uint8Array(buffer));

    offset += CHUNK_SIZE;
    self.postMessage({
      type: 'progress',
      percent: Math.round((offset / file.size) * 100)
    });
  }

  const hash = hasher.digest();
  const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

  self.postMessage({ type: 'complete', hash: hashHex });
};
```

**Note:** Use `@noble/hashes` - pure JS with optional WASM acceleration. Lazy-load the worker only when needed.

### Upload Manager

```javascript
// services/uploadManager.js
export async function uploadGame(file, onProgress) {
  // Phase 1: Hash
  onProgress({ phase: 'hashing', percent: 0 });
  const hash = await hashFile(file, (p) => onProgress({ phase: 'hashing', percent: p }));

  // Phase 2: Prepare
  onProgress({ phase: 'preparing', percent: 0 });
  const prepareRes = await fetch('/api/games/prepare-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blake3_hash: hash,
      file_size: file.size,
      original_filename: file.name
    })
  }).then(r => r.json());

  if (prepareRes.status === 'linked' || prepareRes.status === 'already_owned') {
    onProgress({ phase: 'complete', game_id: prepareRes.game_id });
    return prepareRes;
  }

  // Phase 3: Upload parts
  onProgress({ phase: 'uploading', percent: 0 });
  const etags = await uploadParts(file, prepareRes.parts, (p) =>
    onProgress({ phase: 'uploading', percent: p })
  );

  // Phase 4: Finalize
  onProgress({ phase: 'finalizing', percent: 0 });
  const finalizeRes = await fetch('/api/games/finalize-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_session_id: prepareRes.upload_session_id,
      parts: etags
    })
  }).then(r => r.json());

  onProgress({ phase: 'complete', game_id: finalizeRes.game_id });
  return finalizeRes;
}
```

---

## R2 Configuration

### CORS (Check/Configure)

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://reel-ballers-staging.pages.dev",
      "https://app.reelballers.com"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Task:** Check current R2 CORS config and update if needed.

---

## Implementation Plan

### Phase 1: Backend Foundation
1. Add R2 multipart upload helpers to `storage.py`
2. Add ref_count metadata helpers
3. Create `app/routers/games_upload.py` with new endpoints
4. Update database schema (add migration)
5. Check/configure R2 CORS

### Phase 2: Frontend Upload
1. Create hash worker with `@noble/hashes/blake3`
2. Create upload manager service
3. Create `useGameUpload` hook
4. Update games UI with new upload flow
5. Add delete game button to UI

### Phase 3: Migration
1. Script to migrate user "a" games to global storage
2. Script to delete other test users
3. Update game loading to use new schema

### Phase 4: Integration
1. Update presigned URL generation for game videos
2. Update all places that reference game paths
3. Test full flow end-to-end

---

## Files to Create/Modify

### New Files
- `src/backend/app/routers/games_upload.py` - New upload endpoints
- `src/backend/app/services/multipart.py` - R2 multipart helpers
- `src/frontend/src/workers/hashWorker.js` - BLAKE3 hashing
- `src/frontend/src/services/uploadManager.js` - Upload orchestration
- `src/frontend/src/hooks/useGameUpload.js` - React hook
- `scripts/migrate_games.py` - Migration script

### Modified Files
- `src/backend/app/storage.py` - Add multipart methods, ref_count helpers
- `src/backend/app/routers/games.py` - Update game loading, add delete
- `src/backend/app/database.py` - Schema migration
- `src/frontend/src/hooks/useGames.js` - Use new upload flow
- `src/frontend/src/components/GamesList.jsx` - Add delete button

---

## Chunk Sizes

| Purpose | Size | Rationale |
|---------|------|-----------|
| Hashing chunks | 8MB | Good progress granularity |
| Upload parts | 100MB | Balance speed vs. retry cost |
| Max file size | 10GB | R2 limit: 10,000 parts × 5GB |
| URL expiry | 4 hours | Enough for slow connections |

---

## Acceptance Criteria

- [ ] 4GB+ video uploads work without timeout
- [ ] Same video uploaded by two users stored only once
- [ ] Upload progress shown during hashing and uploading
- [ ] Deleting a game decrements ref_count
- [ ] When ref_count hits 0, R2 object is deleted
- [ ] R2 CORS configured correctly
- [ ] User "a" games migrated to global storage
- [ ] Other test users deleted
- [ ] Delete button works in games UI

---

## Testing Plan

### Manual Tests
1. Upload 4GB video - should complete
2. Upload same video as user "a" twice - second time links instantly
3. Delete game when ref_count > 1 - file stays
4. Delete game when ref_count == 1 - file deleted
5. Check R2 bucket - no orphaned files

### Unit Tests
- BLAKE3 hash produces correct output
- Multipart URL generation
- Ref count increment/decrement
- Finalize with size mismatch fails
