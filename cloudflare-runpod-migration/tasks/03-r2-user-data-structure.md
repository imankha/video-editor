# Task 03: R2 User Data Structure

## Overview
Define how user data is stored in R2, mirroring the exact same structure as the local `user_data/` folder. This keeps local development and cloud deployment using identical paths.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 01 complete (Cloudflare account)
- Task 04 complete (R2 bucket created)

## Time Estimate
20 minutes

---

## Architecture Decision

**We're storing ALL user data in R2**, including the SQLite database file:

1. Same structure as local `user_data/` folder
2. Same SQLite file format - no schema translation needed
3. Simple to understand and debug
4. Can migrate to DO+SQLite later if needed (Task 15)

---

## R2 Bucket Structure

The local `user_data/` folder maps 1:1 to R2:

```
Local filesystem:                   R2 bucket (reel-ballers-users):
user_data/
└── {user_id}/                      {user_id}/
    ├── database.sqlite                 ├── database.sqlite
    ├── games/                          ├── games/
    │   ├── 432b0e2bffba.mp4            │   ├── 432b0e2bffba.mp4
    │   └── 6da56b059497.mp4            │   └── 6da56b059497.mp4
    ├── raw_clips/                      ├── raw_clips/
    │   ├── 01db510ff166.mp4            │   ├── 01db510ff166.mp4
    │   └── 02008bb31687.mp4            │   └── 02008bb31687.mp4
    ├── working_videos/                 ├── working_videos/
    │   └── working_1_9db4ea07.mp4      │   └── working_1_9db4ea07.mp4
    ├── final_videos/                   ├── final_videos/
    │   └── Great_Pass_final.mp4        │   └── Great_Pass_final.mp4
    ├── highlights/                     ├── highlights/
    │   ├── clip_11_frame_28_kf0.png    │   ├── clip_11_frame_28_kf0.png
    │   └── clip_11_frame_47_kf1.png    │   └── clip_11_frame_47_kf1.png
    ├── clip_cache/                     ├── clip_cache/
    ├── downloads/                      ├── downloads/
    └── uploads/                        └── uploads/
```

---

## File Types by Folder

| Folder | Contents | Size | Access Pattern |
|--------|----------|------|----------------|
| `database.sqlite` | All metadata | ~1-10 MB | Read/write on every API call |
| `games/` | Full game videos | 500MB-2GB each | Write once, read rarely |
| `raw_clips/` | Extracted clips | 5-15 MB each | Write once, read for export |
| `working_videos/` | Processed clips | 5-15 MB each | Write after export |
| `final_videos/` | Exported videos | 10-50 MB each | Write once, download often |
| `highlights/` | Keyframe images | 50-200 KB each | Write once, read for UI |
| `clip_cache/` | Temporary files | Varies | Ephemeral |
| `uploads/` | User uploads | Varies | Write once |

---

## R2 Key Naming Convention

```typescript
// Helper to generate R2 keys
function r2Key(userId: string, path: string): string {
  return `${userId}/${path}`;
}

// Examples:
r2Key('a', 'database.sqlite')           // 'a/database.sqlite'
r2Key('a', 'games/432b0e2bffba.mp4')    // 'a/games/432b0e2bffba.mp4'
r2Key('a', 'highlights/clip_11_kf0.png') // 'a/highlights/clip_11_kf0.png'
```

---

## Storage Abstraction Layer

Create a unified storage interface that works for both local and R2:

```typescript
// workers/src/storage/types.ts

export interface StorageBackend {
  // Read/write files
  get(key: string): Promise<ReadableStream | null>;
  put(key: string, data: ReadableStream | ArrayBuffer): Promise<void>;
  delete(key: string): Promise<void>;

  // List files
  list(prefix: string): Promise<string[]>;

  // Signed URLs for direct upload/download
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
  getUploadUrl(key: string, expiresIn: number): Promise<string>;
}
```

```typescript
// workers/src/storage/r2.ts

export class R2Storage implements StorageBackend {
  constructor(private bucket: R2Bucket, private userId: string) {}

  private key(path: string): string {
    return `${this.userId}/${path}`;
  }

  async get(path: string): Promise<ReadableStream | null> {
    const obj = await this.bucket.get(this.key(path));
    return obj?.body ?? null;
  }

  async put(path: string, data: ReadableStream | ArrayBuffer): Promise<void> {
    await this.bucket.put(this.key(path), data);
  }

  async delete(path: string): Promise<void> {
    await this.bucket.delete(this.key(path));
  }

  async list(prefix: string): Promise<string[]> {
    const fullPrefix = this.key(prefix);
    const listed = await this.bucket.list({ prefix: fullPrefix });
    return listed.objects.map(obj => obj.key.replace(`${this.userId}/`, ''));
  }

  async getSignedUrl(path: string, expiresIn: number): Promise<string> {
    // R2 presigned URLs require custom implementation
    // See Task 06 for full implementation
    throw new Error('Implement in Task 06');
  }
}
```

---

## SQLite in R2

The SQLite database file is stored in R2 and loaded/saved on each request:

```typescript
// workers/src/storage/sqlite.ts

import initSqlJs, { Database } from 'sql.js';

export class R2SqliteDatabase {
  private db: Database | null = null;

  constructor(
    private bucket: R2Bucket,
    private userId: string
  ) {}

  private get key(): string {
    return `${this.userId}/database.sqlite`;
  }

  async load(): Promise<Database> {
    if (this.db) return this.db;

    // Initialize SQL.js (WebAssembly SQLite)
    const SQL = await initSqlJs();

    // Try to load existing database
    const existing = await this.bucket.get(this.key);
    if (existing) {
      const buffer = await existing.arrayBuffer();
      this.db = new SQL.Database(new Uint8Array(buffer));
    } else {
      // Create new database with schema
      this.db = new SQL.Database();
      this.initializeSchema();
    }

    return this.db;
  }

  async save(): Promise<void> {
    if (!this.db) return;
    const data = this.db.export();
    await this.bucket.put(this.key, data.buffer);
  }

  private initializeSchema(): void {
    // Same schema as local SQLite - see existing database.sqlite
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        video_path TEXT,
        thumbnail_path TEXT,
        duration REAL,
        fps REAL,
        width INTEGER,
        height INTEGER,
        opponent_name TEXT,
        game_date TEXT,
        game_type TEXT DEFAULT 'away',
        tournament_name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS raw_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        video_path TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        rating INTEGER DEFAULT 3,
        tags TEXT DEFAULT '[]',
        notes TEXT,
        thumbnail_path TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        aspect_ratio TEXT DEFAULT '9:16',
        output_width INTEGER DEFAULT 1080,
        output_height INTEGER DEFAULT 1920,
        is_auto_created INTEGER DEFAULT 0,
        working_video_path TEXT,
        has_working_video INTEGER DEFAULT 0,
        has_overlay_edits INTEGER DEFAULT 0,
        has_final_video INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_opened_at TEXT
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS working_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        raw_clip_id INTEGER NOT NULL,
        clip_index INTEGER NOT NULL,
        crop_keyframes TEXT DEFAULT '[]',
        is_exported INTEGER DEFAULT 0,
        exported_path TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id)
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS highlight_regions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        start_frame INTEGER NOT NULL,
        end_frame INTEGER NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        radius_x REAL NOT NULL,
        radius_y REAL NOT NULL,
        opacity REAL DEFAULT 1.0,
        color TEXT DEFAULT '#ffffff',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS final_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        game_id INTEGER,
        name TEXT NOT NULL,
        video_path TEXT NOT NULL,
        thumbnail_path TEXT,
        source_type TEXT NOT NULL,
        duration REAL,
        file_size INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
      )
    `);
  }
}
```

---

## Request Pattern

Every API request that needs user data:

```typescript
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const userId = getUserId(request);  // From cookie or header

  // Load user's database from R2
  const db = new R2SqliteDatabase(env.R2_BUCKET, userId);
  await db.load();

  try {
    // Handle the request...
    const result = await processRequest(db, request);

    // Save database back to R2 if modified
    await db.save();

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
```

---

## Performance Considerations

| Concern | Solution |
|---------|----------|
| SQLite load time | Database is ~1-10MB, R2 is fast, acceptable latency |
| Concurrent writes | Single user unlikely to have concurrent requests |
| Large game files | Direct upload to R2 via presigned URLs |
| Bandwidth costs | R2 has no egress fees |

**When to migrate to DO+SQLite (Task 15)**:
- If SQLite load/save latency becomes noticeable
- If you need real-time collaboration features
- If concurrent write conflicts become an issue

---

## Dependencies

Add to `workers/package.json`:

```json
{
  "dependencies": {
    "sql.js": "^1.10.0"
  }
}
```

The SQL.js WASM file needs to be bundled or loaded from CDN.

---

## Handoff Notes

**For Task 04 (R2 Bucket Setup)**:
- Bucket name: `reel-ballers-users`
- No special folder structure needed - keys create "folders" automatically
- Configure CORS for direct browser uploads

**For Task 06 (API Routes)**:
- Use R2Storage class for file operations
- Use R2SqliteDatabase for database operations
- Always save database after modifications

**For Task 08 (GPU Worker)**:
- GPU worker downloads files from R2 using presigned URLs
- After processing, uploads result back to R2
- Same key structure: `{user_id}/final_videos/{name}.mp4`
