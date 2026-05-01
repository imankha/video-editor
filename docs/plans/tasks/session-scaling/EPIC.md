# Epic: Session Scaling & Write-Back Sync

**Status:** TODO
**Created:** 2026-05-01

## Goal

Make per-user SQLite+R2 correct and performant at multi-machine scale. Session pinning ensures one machine owns each user's data. Write-back sync eliminates per-gesture R2 latency. Single active session handoff ensures clean device switching with R2 sync before sign-out. Data loss detection and recovery handles the rare crash scenario gracefully.

## Why

Per-user SQLite+R2 is the correct and cheapest persistence model for user-scoped data (validated through architecture review, 2026-05-01). But it requires three infrastructure pieces to work at scale:

1. **Session pinning** (T1190) — without it, two machines can serve the same user and race on R2 uploads
2. **Write-back sync** (T2250) — currently every gesture blocks the response for 50-200ms of R2 upload. With session pinning, the local SQLite is authoritative during the session; R2 is just a backup. Sync periodically instead of on every write.
3. **Single active session handoff** (T40) — when a user signs in on a new device, the old device must sync to R2 and be signed out cleanly before the new device begins editing. Prevents data loss during device switching.
4. **Data loss detection** (T2260) — write-back introduces a ~3 minute data loss window on machine crash. Detect it, credit the user, and communicate clearly.

## Sequencing

| # | ID | Task | Why This Order |
|---|----|------|----------------|
| 1 | T1190 | [Session & Machine Pinning](T1190-session-machine-pinning.md) | Foundation — all subsequent tasks assume one machine per user. Must ship first. |
| 2 | T2250 | [Write-Back R2 Sync](T2250-write-back-r2-sync.md) | Requires session pinning. Moves R2 sync from blocking-per-gesture to periodic background + explicit triggers. |
| 3 | T40 | [Single Active Session Handoff](T40-single-active-session-handoff.md) | Requires session pinning (session invalidation) + write-back sync (sync-before-401). Orchestrates the device handoff: auto-signout, R2 sync, failure handling, frontend UX. |
| 4 | T2260 | [Data Loss Detection & Recovery](T2260-data-loss-detection-recovery.md) | Fallback for when T40's sync-before-401 fails. Detects version gaps on reconnect, auto-grants credits, notifies user. |

## Shared Context

### Current vs Target Write Flow

| Step | Current (write-through) | Target (write-back) |
|------|-------------------------|---------------------|
| User gesture | SQLite write (~0.1ms) | SQLite write (~0.1ms) |
| R2 sync | Blocks response (50-200ms) | Deferred to background |
| Response to user | After R2 confirms (~200ms total) | After SQLite confirms (~0.1ms total) |
| Durability | Immediate (R2 has latest) | Periodic (~3 min max staleness) |
| Data loss on crash | ~0 (response = R2 confirmed) | Up to ~3 min of edits |

### Single Active Session Flow

```
Device A: editing on Machine 1
Device B: user signs in

1. POST /auth/login → Postgres: existing session? → Yes (Machine 1)
2. Invalidate old session in Postgres
3. Create new session for Device B → Machine 2

4. Device A's next request → validate_session → invalid
5. Machine 1: SYNC TO R2 before returning 401
6. Machine 1: return 401 { reason: "signed_in_elsewhere" }

7. Device B: ensure_database() → download from R2 (includes Machine 1's final sync)
8. Editing continues with zero data loss
```

### Sync Triggers (Write-Back Model)

| Trigger | Data Loss | Priority |
|---------|-----------|----------|
| Export start | 0 | Highest — must sync before GPU job |
| Sign-out | 0 | High — final sync, block until confirmed |
| Session invalidation (new sign-in elsewhere) | 0 | High — sync before 401 |
| Periodic timer (~3 min) | 0-3 min | Medium — background, non-blocking |
| Machine restart (.sync_pending marker) | 0 if volume survives | Recovery path |

## Dependencies

- **T1960** (Migrate Auth to Fly Postgres) — session validation must query Postgres for single-active-session enforcement. Can be implemented in parallel but must be deployed together.

## Completion Criteria

- [ ] All requests from a session hit the same machine (T1190)
- [ ] Write responses are not blocked by R2 sync (T2250)
- [ ] R2 sync happens on sign-out, export, session invalidation, and periodically (T2250)
- [ ] Sign-out blocks until sync succeeds or warns user on failure (T2250)
- [ ] New login invalidates existing session; old device syncs before 401 (T40)
- [ ] Old device shows clear "signed in elsewhere" UX, not a confusing error (T40)
- [ ] Sync failure during handoff retries up to 3x, then accepts loss gracefully (T40)
- [ ] Data loss detected via version comparison on reconnect (T2260)
- [ ] User notified and credited when data loss occurs (T2260)
- [ ] Export-specific pinning hack removed (T1190)
