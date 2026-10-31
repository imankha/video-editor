# T14120: Clip-upload refund check scans all history every hour

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

The hourly clip-upload refund verifier (`services/cleanup.py` ~150-161) selects `credit_transactions WHERE source='clip_upload' AND created_at < cutoff` with NO lower bound. Every successful batch has no refund row, so it is re-checked every hour forever, and each check calls `ensure_profile_db_local` (R2 HEAD, possibly download + JIT migration; `materialization.py` ~80-140), one at a time. Cost grows with every clip upload ever made: ~100K batches means ~100K R2 HEADs an hour and runs that last hours.

## Solution

Bound the window (for example `now-48h .. now-24h`, matching the verifier's purpose) or record a verified marker so a batch is checked once. Pick whichever keeps the refund guarantee; a batch that is never checked would be a silent credit leak.

## Context

### Relevant Files
- `src/backend/app/services/cleanup.py`
- `src/backend/tests/` (new bounded-window test)

### Notes
Load: backend-services.md, persistence-sync.md.

## Acceptance Criteria

- [ ] A test proves an old, already-verified batch is not re-checked and a batch inside the window still is
- [ ] Per-run R2 HEAD count no longer grows with total history
