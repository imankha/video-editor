# T890: Export Transaction Atomicity

**Status:** TESTING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-02
**Depends On:** T920

## Problem

Export job creation splits operations across multiple transactions and multiple databases. If the server crashes between transactions, the system is left in an inconsistent state.

### Split #1: Status regression + job creation (same DB, separate commits)

In `framing.py:673-693`, project video IDs are cleared in one commit (line 680), then export_jobs is inserted in a second (line 693). If the second fails, the project is regressed with no job to track.

### Split #2: Credit deduction + job creation (different DBs)

Credits live in user.sqlite (after T920), export_jobs live in profile database.sqlite. These can never share a SQLite transaction.

If the server crashes after deduction but before job creation: credits charged, no job, no refund path.

### Split #3: Job completion + video creation (same DB, separate commits)

`export_worker.py` marks jobs complete in a separate transaction from creating working_video/final_video records.

## SQLite Atomicity

- **Same-file transactions**: All statements between BEGIN and COMMIT are atomic. This fixes splits #1 and #3.
- **Cross-file**: Two `.sqlite` files cannot share a transaction. Split #2 requires a different pattern.

## Solution

### Fix 1: Combine same-DB splits (trivial)

Status regression + job creation → single commit:
```python
with get_db_connection() as conn:
    conn.execute("UPDATE projects SET working_video_id=NULL, final_video_id=NULL WHERE id=?", (pid,))
    conn.execute("INSERT INTO export_jobs (...) VALUES (...)")
    conn.commit()
```

Job completion + video creation → single commit:
```python
with get_db_connection() as conn:
    conn.execute("INSERT INTO working_videos (...) VALUES (...)")
    conn.execute("UPDATE projects SET working_video_id=? ...", ...)
    conn.execute("UPDATE export_jobs SET status='complete' ...")
    conn.commit()
```

Also remove the duplicate export_jobs INSERT in framing.py (lines 693 vs 722).

### Fix 2: Credit reservation pattern (cross-DB)

T920 adds a `credit_reservations` table in user.sqlite. The pattern:

```
Step 1: reserve_credits(user_id, amount, job_id)
        → user.sqlite: INSERT credit_reservations, UPDATE credits -= amount
        → ATOMIC (single transaction)

Step 2: create_export_job(job_id, project_id, ...)
        → database.sqlite: INSERT export_jobs + UPDATE projects
        → ATOMIC (single transaction)

Step 3: confirm_reservation(job_id)
        → user.sqlite: DELETE reservation, INSERT credit_transaction
        → ATOMIC (single transaction)

On failure at step 2:
    release_reservation(job_id)
        → user.sqlite: DELETE reservation, UPDATE credits += amount

Startup recovery:
    SELECT * FROM credit_reservations WHERE created_at < datetime('now', '-60 seconds')
    → For each: check if matching export_job exists in profile DB
    → If yes: confirm (job was created, reservation should be finalized)
    → If no: release (job never created, return credits)
```

### Fix 3: Sync user.sqlite to R2 after deduction

Currently `deduct_credits()` does NOT sync to R2. If the server crashes, cold start restores pre-deduction balance — user gets a free export. After T920, user.sqlite must sync to R2 after credit operations, same as database.sqlite does via middleware.

## Relevant Files

- `src/backend/app/routers/export/framing.py` — Lines 673-722: split transactions
- `src/backend/app/routers/export/multi_clip.py` — Lines 1190-1210: split transactions
- `src/backend/app/services/export_worker.py` — Lines 137-297: job lifecycle
- `src/backend/app/routers/exports.py` — Lines 541-578: credit deduction + job creation
- `src/backend/app/services/user_db.py` (after T920) — reserve/confirm/release credit functions

## Acceptance Criteria

- [ ] Status regression + job creation in single transaction (framing + multi-clip)
- [ ] Job completion + video creation + project update in single transaction
- [ ] Credit reservation pattern implemented (reserve → create job → confirm)
- [ ] Startup recovery for orphaned reservations
- [ ] Duplicate export_jobs INSERT removed (framing.py)
- [ ] user.sqlite synced to R2 after all credit operations
