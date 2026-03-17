# T510: GPU Cost Gate

**Status:** TODO
**Impact:** 9
**Complexity:** 3
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

GPU operations cost real money. Without a cost gate, authenticated users could run unlimited GPU jobs. Need to check credits before every GPU operation, deduct on start, and refund on failure.

## Solution

Add a credit check before GPU operations (annotation video, clip export, upscale). If sufficient credits: deduct → start job. If insufficient: show purchase modal. If job fails: auto-refund.

## Context

### Relevant Files
- `src/backend/app/routers/export.py` or equivalent - Add credit check before GPU dispatch
- `src/backend/app/routers/credits.py` - From T505: deduct/refund functions
- `src/frontend/src/stores/creditStore.js` - Check balance client-side (optimistic)
- Frontend components that trigger exports - Add credit check before API call

### Related Tasks
- Depends on: T505 (credit system backend)
- Depends on: T500 (insufficient credits modal)

### Technical Notes

**Cost per operation (preliminary — finalized in T520):**
```
annotation_video: 1 credit
clip_export:      1 credit
upscale:          2 credits
```

**Flow:**
```
Frontend: canAfford(cost)?
  No  → show InsufficientCreditsModal
  Yes → call export API

Backend: POST /api/export/start
  1. Check credits >= cost (authoritative check)
  2. If insufficient → 402 response
  3. Deduct credits (source="gpu_usage", reference=job_id)
  4. Start GPU job
  5. If GPU job fails → grant credits back (source="gpu_refund", reference=job_id)
```

**Refund on failure:**
- GPU job status tracked in export_jobs table
- On job failure callback → auto-refund
- Ledger entry: amount=+1, source="gpu_refund", reference=job_id

## Implementation

### Steps
1. [ ] Define cost constants per operation type
2. [ ] Add credit check to frontend GPU-triggering actions
3. [ ] Add credit check + deduct to backend export endpoint
4. [ ] Add refund logic on GPU job failure
5. [ ] Test: export with credits → succeeds, balance decremented
6. [ ] Test: export with 0 credits → blocked, modal shown
7. [ ] Test: GPU failure → credits refunded

## Acceptance Criteria

- [ ] GPU operations blocked when credits insufficient
- [ ] Credits deducted before GPU job starts
- [ ] Credits refunded on GPU job failure
- [ ] Both frontend (optimistic) and backend (authoritative) checks
- [ ] Ledger records all debits and refunds with job reference
- [ ] InsufficientCreditsModal shown on frontend check failure
