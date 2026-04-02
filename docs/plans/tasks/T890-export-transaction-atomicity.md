# T890: Export Transaction Atomicity

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-02

## Problem

Export job creation splits operations across multiple separate transactions. If the server crashes or a write fails between transactions, the system is left in an inconsistent state that requires manual intervention.

### Split Transaction #1: Framing Status Regression + Job Creation

In `framing.py:673-693`, project video IDs are cleared in one transaction (line 680), then the export_jobs record is created in a second (line 693). If the second fails:

- Project shows "Not Started" (video IDs cleared)
- No export_jobs record exists to track or recover
- User's previous export result is gone with no new job to replace it

### Split Transaction #2: Credit Deduction + Job Creation

Credit deduction happens in `auth.sqlite` (exports.py:541), but job creation happens in the per-user DB (exports.py:572-578). These are **separate SQLite files** — impossible to make atomic with SQLite alone.

If the server crashes after deduction but before job creation:
- Credits charged, no job record, no refund path (no job_id to refund against)

### Split Transaction #3: Job Completion + Video Creation

`export_worker.py` marks jobs complete (line 157) in a separate transaction from creating the working_video/final_video record (line 282-297). If video creation fails after job is marked complete:
- Job shows "complete" but project has no video
- Orphaned state

## SQLite Atomicity Mechanisms

SQLite provides:
- **Single-connection transactions**: All statements between BEGIN and COMMIT are atomic
- **WAL mode**: Allows concurrent readers during a write transaction
- **SAVEPOINT**: Nested transaction support within a connection
- **No cross-database transactions**: Two separate .sqlite files cannot share a transaction

**Limitation**: Credit operations (auth.sqlite) and user data operations (per-user database.sqlite) can never be in the same transaction.

## Solution

### Fix 1: Combine status regression + job creation (same DB)

Move the project status regression into the same transaction as export_jobs INSERT:

```python
# framing.py — ONE transaction
with get_db_connection() as conn:
    conn.execute("UPDATE projects SET working_video_id=NULL, final_video_id=NULL WHERE id=?", (pid,))
    conn.execute("INSERT INTO export_jobs (id, project_id, type, status) VALUES (?, ?, ?, 'processing')", ...)
    conn.commit()
```

Same fix for multi_clip.py:1190-1206.

### Fix 2: Credit deduction with job reference

Since auth.sqlite and user DB can't share a transaction, use a **compensating transaction** pattern:

1. Create job record FIRST (status='pending_payment')
2. Deduct credits with job_id as reference
3. Update job status to 'processing'
4. If step 2 fails → delete job record
5. If step 3 fails → refund credits using job_id

Add a startup recovery check: find jobs in 'pending_payment' status older than 60s → refund credits if deducted, delete job.

### Fix 3: Combine job completion + video creation

Already mostly done in the codebase (multi_clip.py:1593-1610 is atomic). Apply the same pattern to export_worker.py framing/overlay paths:

```python
# export_worker.py — ONE transaction
with get_db_connection() as conn:
    conn.execute("INSERT INTO working_videos ...", ...)
    conn.execute("UPDATE projects SET working_video_id=? ...", ...)
    conn.execute("UPDATE export_jobs SET status='complete' ...", ...)
    conn.commit()
```

### Fix 4: Also sync auth.sqlite after deduct_credits()

Currently `deduct_credits()` does NOT call `sync_auth_db_to_r2()` — only grant/refund/set do. If the server crashes after deduction, cold start restores the pre-deduction balance from R2 — user gets free export.

Add `sync_auth_db_to_r2()` call after `deduct_credits()`.

## Relevant Files

- `src/backend/app/routers/export/framing.py` — Lines 673-722: split transactions
- `src/backend/app/routers/export/multi_clip.py` — Lines 1190-1210: split transactions
- `src/backend/app/services/export_worker.py` — Lines 137-297: job lifecycle
- `src/backend/app/routers/exports.py` — Lines 541-578: credit deduction + job creation
- `src/backend/app/services/auth_db.py` — Lines 489-520: `deduct_credits()` (missing R2 sync)

## Acceptance Criteria

- [ ] Status regression + job creation in single transaction (framing + multi-clip)
- [ ] Job completion + video creation + project update in single transaction
- [ ] Credit deduction has compensating transaction pattern with startup recovery
- [ ] `deduct_credits()` syncs auth.sqlite to R2
- [ ] No duplicate export_jobs INSERT (framing.py:693 vs 722)
