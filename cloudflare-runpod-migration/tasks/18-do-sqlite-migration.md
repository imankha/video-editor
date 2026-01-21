# Task 18: Durable Objects + SQLite Migration (Conditional)

## Overview
Migrate from in-memory SQLite (loaded from R2) to Durable Objects with embedded SQLite for improved performance and real-time capabilities.

## Owner
**Claude** - Code migration task

## Prerequisites
- Database size consistently > 1MB
- Performance issues with R2 sync
- Or need for real-time collaboration

## Status
`CONDITIONAL` - Only implement when database size exceeds threshold

---

## When to Migrate

The current system (Task 04) logs when migration should be considered:

```python
DB_SIZE_WARNING_THRESHOLD = 512 * 1024   # 512KB - info log
DB_SIZE_MIGRATION_THRESHOLD = 1024 * 1024  # 1MB - warning log
```

**Migrate when you see this log consistently:**
```
WARN: DATABASE MIGRATION RECOMMENDED: Database size (1.2MB) exceeds 1MB.
      Consider migrating archived data to Durable Objects.
```

---

## Why Migrate?

| Symptom | How DO+SQLite Helps |
|---------|---------------------|
| Slow API responses | SQLite stays in memory, no R2 round-trip |
| Concurrent write conflicts | DO provides single-writer guarantee |
| Need real-time sync | DO can hold WebSocket connections |
| Database > 1MB | DO SQLite handles large DBs better |

**Don't migrate preemptively** - R2-based SQLite works well for most use cases.

---

## Architecture Change

### Before (R2-based SQLite)
```
Request -> Worker -> Load SQLite from R2 -> Query -> Save to R2 -> Response
                     ~~~~~~ 50-200ms ~~~~~~
```

### After (DO+SQLite)
```
Request -> Worker -> Forward to DO -> Query in-memory SQLite -> Response
                     ~~~~~~ 5-20ms ~~~~~~
```

---

## Migration Strategy

### Option A: Split Hot/Cold Data

Keep active data in request-level SQLite, move archived data to DO:

```
Hot Data (R2 SQLite):           Cold Data (DO SQLite):
├── Active projects             ├── Archived projects
├── Recent clips                ├── Old clips
├── Recent games                ├── Archived games
└── Current exports             └── Old exports
```

### Option B: Full Migration to DO

Move entire database to Durable Object per user:

```typescript
// Each user gets their own DO instance
const userDataId = env.USER_DATA_DO.idFromName(userId);
const userStore = env.USER_DATA_DO.get(userDataId);
```

---

## Implementation Outline

### 1. Create UserDataStore Durable Object

```typescript
export class UserDataStore {
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    this.sql = state.storage.sql;
    this.initializeSchema();
  }

  private initializeSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS games (...);
      CREATE TABLE IF NOT EXISTS raw_clips (...);
      CREATE TABLE IF NOT EXISTS projects (...);
      -- Same schema as R2 SQLite
    `);
  }

  async fetch(request: Request): Promise<Response> {
    // Handle queries via REST
  }
}
```

### 2. Create Migration Script

```typescript
async function migrateUser(userId: string, env: Env) {
  // 1. Load SQLite from R2
  const r2Data = await loadFromR2(userId, env);

  // 2. Get DO instance for user
  const doId = env.USER_DATA_DO.idFromName(userId);
  const userStore = env.USER_DATA_DO.get(doId);

  // 3. Import data into DO
  await userStore.fetch(new Request('https://do/migrate', {
    method: 'POST',
    body: JSON.stringify(r2Data),
  }));

  // 4. Verify migration
  // 5. Mark user as migrated in KV
  await env.KV.put(`migrated:${userId}`, 'true');
}
```

### 3. Gradual Rollout

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
    return handleWithR2(request, env);
  }
}
```

---

## Video Files Stay in R2

Only the SQLite database moves to DO. Videos remain in R2:

```
After Migration:
├── Durable Objects
│   └── UserDataStore (per user)
│       └── SQLite (metadata)
│
└── R2 Bucket
    └── {user_id}/
        ├── games/*.mp4          (stays in R2)
        ├── raw_clips/*.mp4      (stays in R2)
        ├── working_videos/*.mp4 (stays in R2)
        └── final_videos/*.mp4   (stays in R2)
```

---

## Cost Comparison

| Model | Storage | Requests | Best For |
|-------|---------|----------|----------|
| R2 SQLite | $0.015/GB/mo | $0.36/M reads | Simple, low traffic |
| DO SQLite | $0.20/GB/mo | Included | High traffic, real-time |

DO is more expensive for storage but includes request costs. Break-even is around 10+ requests per user per day.

---

## Rollback Plan

If issues occur:
1. Re-enable R2 SQLite path in code
2. Clear migration flag in KV
3. Keep R2 SQLite files for 30 days after migration

---

## Handoff Notes

This task is for **future reference**. Current implementation uses R2-based SQLite which is simpler and sufficient for initial launch.

Revisit this task when:
- API latency becomes a user complaint
- Database size warnings appear consistently
- You need real-time collaborative features
