# Task 15: Migrate to Durable Objects + SQLite

## Overview
Migrate from SQLite-in-R2 to Durable Objects with embedded SQLite for improved performance and real-time capabilities. This is a **future optimization** - only do this when needed.

## Owner
**Claude** - Code migration task

## Prerequisites
- Core system working with R2-based SQLite
- Performance issues or feature needs that require DO+SQLite

## Time Estimate
4-6 hours

## Status
`FUTURE` - Not needed initially

---

## When to Migrate

Migrate to DO+SQLite when you experience:

| Symptom | Why DO+SQLite Helps |
|---------|---------------------|
| Slow API responses | SQLite stays in memory, no R2 round-trip |
| Concurrent write conflicts | DO provides single-writer guarantee |
| Need real-time sync | DO can hold WebSocket connections |
| Database > 50MB | DO SQLite handles large DBs better |

**Don't migrate preemptively** - R2-based SQLite is simpler and works well for most use cases.

---

## Architecture Change

### Before (R2-based SQLite)
```
Request → Worker → Load SQLite from R2 → Query → Save to R2 → Response
                   ~~~~~~ 50-200ms ~~~~~~
```

### After (DO+SQLite)
```
Request → Worker → Forward to DO → Query in-memory SQLite → Response
                   ~~~~~~ 5-20ms ~~~~~~
```

---

## Migration Steps

### 1. Create UserDataStore Durable Object

```typescript
// workers/src/durable-objects/UserDataStore.ts

export class UserDataStore {
  private sql: SqlStorage;

  constructor(private state: DurableObjectState, private env: Env) {
    this.sql = state.storage.sql;
    this.initializeSchema();
  }

  private initializeSchema() {
    // Same schema as R2SqliteDatabase
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS games (...);
      CREATE TABLE IF NOT EXISTS raw_clips (...);
      CREATE TABLE IF NOT EXISTS projects (...);
      CREATE TABLE IF NOT EXISTS working_clips (...);
      CREATE TABLE IF NOT EXISTS highlight_regions (...);
      CREATE TABLE IF NOT EXISTS final_videos (...);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Route to appropriate handler based on path
    // ... (see original Task 03 for full implementation)
  }
}
```

### 2. Update wrangler.toml

```toml
[durable_objects]
bindings = [
  { name = "USER_DATA", class_name = "UserDataStore" },
  { name = "EXPORT_JOB", class_name = "ExportJobState" }
]

[[migrations]]
tag = "v2"
new_classes = ["UserDataStore"]
```

### 3. Create Migration Script

```typescript
// scripts/migrate-r2-to-do.ts

async function migrateUser(userId: string, env: Env) {
  // 1. Load SQLite from R2
  const r2Db = new R2SqliteDatabase(env.USER_DATA_BUCKET, userId);
  await r2Db.load();

  // 2. Get DO for this user
  const doId = env.USER_DATA.idFromName(userId);
  const userStore = env.USER_DATA.get(doId);

  // 3. Export all data from R2 SQLite
  const games = r2Db.all('SELECT * FROM games');
  const rawClips = r2Db.all('SELECT * FROM raw_clips');
  const projects = r2Db.all('SELECT * FROM projects');
  const workingClips = r2Db.all('SELECT * FROM working_clips');
  const highlightRegions = r2Db.all('SELECT * FROM highlight_regions');
  const finalVideos = r2Db.all('SELECT * FROM final_videos');

  // 4. Import into DO
  await userStore.fetch(new Request('https://do/migrate', {
    method: 'POST',
    body: JSON.stringify({
      games,
      rawClips,
      projects,
      workingClips,
      highlightRegions,
      finalVideos
    })
  }));

  // 5. Verify migration
  const doGames = await userStore.fetch(new Request('https://do/games'));
  const doGamesData = await doGames.json();

  if (doGamesData.length !== games.length) {
    throw new Error(`Migration verification failed for user ${userId}`);
  }

  console.log(`Migrated user ${userId}: ${games.length} games, ${projects.length} projects`);
}
```

### 4. Update API Routes

```typescript
// Before: R2-based
async function handleGetProjects(request: Request, env: Env) {
  const userId = getUserId(request);
  const db = new R2SqliteDatabase(env.USER_DATA_BUCKET, userId);
  await db.load();
  const projects = db.all('SELECT * FROM projects');
  return Response.json(projects);
}

// After: DO-based
async function handleGetProjects(request: Request, env: Env) {
  const userId = getUserId(request);
  const userStore = getUserStore(userId, env);
  return userStore.fetch(new Request('https://do/projects'));
}

function getUserStore(userId: string, env: Env): DurableObjectStub {
  const id = env.USER_DATA.idFromName(userId);
  return env.USER_DATA.get(id);
}
```

---

## Gradual Migration Strategy

You can migrate users gradually using a feature flag:

```typescript
async function handleRequest(request: Request, env: Env) {
  const userId = getUserId(request);

  // Check if user is migrated
  const migrated = await env.KV.get(`migrated:${userId}`);

  if (migrated) {
    // Use Durable Object
    const userStore = getUserStore(userId, env);
    return userStore.fetch(request);
  } else {
    // Use R2 SQLite
    const db = new R2SqliteDatabase(env.USER_DATA_BUCKET, userId);
    await db.load();
    // ... handle with R2
  }
}
```

---

## Video Files Stay in R2

Only the SQLite database moves to DO. Video files remain in R2:

```
After Migration:
├── Durable Objects
│   └── UserDataStore (per user)
│       └── SQLite (games, projects, clips metadata)
│
└── R2 Bucket
    └── {user_id}/
        ├── games/*.mp4          (stays in R2)
        ├── raw_clips/*.mp4      (stays in R2)
        ├── working_videos/*.mp4 (stays in R2)
        ├── final_videos/*.mp4   (stays in R2)
        └── highlights/*.png     (stays in R2)
```

---

## Rollback Plan

If issues occur, rollback by:

1. Re-enable R2 SQLite path in code
2. Export data from DO back to R2 SQLite
3. Deploy rollback

Keep the R2 SQLite files for at least 30 days after migration.

---

## Cost Comparison

| Model | Storage | Requests | Best For |
|-------|---------|----------|----------|
| R2 SQLite | $0.015/GB/mo | $0.36/M reads | Simple, low traffic |
| DO SQLite | $0.20/GB/mo | Included | High traffic, real-time |

DO is more expensive for storage but includes request costs. Break-even is around 10+ requests per user per day.

---

## Handoff Notes

This task is for future reference. Current implementation uses R2-based SQLite which is simpler and sufficient for initial launch.

Revisit this task when:
- API latency becomes a user complaint
- You need real-time collaborative features
- Single user making many rapid requests
