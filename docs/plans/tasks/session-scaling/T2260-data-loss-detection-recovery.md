# T2260: Data Loss Detection & Recovery

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-05-01

## Problem

Write-back sync (T2250) introduces a ~3 minute data loss window on machine crash. If the machine dies between periodic syncs, the user's last few edits are lost. The system must detect this, communicate it clearly, and compensate the user.

This is rare (requires machine crash during active editing session) but must be handled gracefully — silent data loss erodes trust.

## Solution

### Detection: Version Comparison

The backend already tracks `db_version` (integer, incremented on each R2 sync). Use this to detect gaps.

**Backend side:**
- Every write response includes `X-DB-Version: <n>` header (the local version, including unsynced writes)
- On successful periodic sync, version increments in R2

**Frontend side:**
- Track `lastConfirmedVersion` in memory (updated from `X-DB-Version` on every response)
- On reconnect (new machine, post-crash, session re-pin), first data fetch returns the R2 version
- If `serverVersion < lastConfirmedVersion` → data loss detected

**Edge case — normal machine switch (deploy, scale-down):**
- Graceful shutdown syncs all dirty users (T2250) → no version gap
- Only ungraceful crashes produce a gap

### Recovery: Auto-Credit + Notification

When data loss is detected:

1. **Backend** logs the event: `user_id`, `expected_version`, `actual_version`, `estimated_edits_lost`
2. **Backend** auto-grants goodwill credits via existing `admin_grant` credit source:
   - Formula: `max(10, estimated_seconds_lost * 0.5)` credits
   - Reference: `data_loss_recovery_{user_id}_{timestamp}`
   - Idempotent via existing `idx_credit_tx_idempotent` unique constraint
3. **Frontend** shows a non-blocking notification:
   - "Some recent edits were lost due to a server restart. We've added {N} free credits to your account."
   - Dismissable, not modal — don't block the user from continuing to edit
   - Include "What happened?" expandable with: "Your last ~{minutes} of edits before the restart couldn't be saved. This is rare and we're sorry for the inconvenience."

### Estimating lost edits

The version gap tells us syncs were missed, but not how many edits. Approximate:
- `versions_behind = lastConfirmedVersion - serverVersion`
- Each version represents one periodic sync interval (~3 minutes)
- `estimated_minutes_lost = versions_behind * SYNC_INTERVAL_MINUTES`
- `estimated_seconds_lost = estimated_minutes_lost * 60`

This is rough but sufficient for credit calculation. Erring on the side of generosity is correct.

## Changes

### Backend

**Response headers (middleware):**
- Add `X-DB-Version` header to all authenticated responses
- Value: current local db_version (from in-memory cache, no DB read)

**Credit grant endpoint:**
- `POST /api/internal/data-loss-recovery` (called by frontend on detection)
- Body: `{ expected_version, actual_version }`
- Validates: gap is real (actual_version < expected_version)
- Grants credits via `grant_credits(user_id, amount, source="data_loss_recovery", reference_id=...)`
- Returns: `{ credits_granted, message }`
- Idempotent: same reference_id won't double-grant

**Logging:**
- Log at WARNING level: `[DATA_LOSS] user={user_id} expected_v={n} actual_v={m} gap={n-m}`
- Include in admin dashboard metrics (future)

### Frontend

**Version tracking (new module or in syncStore):**
```javascript
let lastConfirmedVersion = null;

// Called on every API response
function updateVersion(response) {
  const v = response.headers.get('X-DB-Version');
  if (v) lastConfirmedVersion = parseInt(v, 10);
}

// Called on reconnect / machine switch
function checkForDataLoss(serverVersion) {
  if (lastConfirmedVersion && serverVersion < lastConfirmedVersion) {
    reportDataLoss(lastConfirmedVersion, serverVersion);
  }
  lastConfirmedVersion = serverVersion;
}
```

**Notification (toast or banner):**
- Non-modal, dismissable
- Shows credit grant amount
- "What happened?" expandable section
- Auto-dismiss after 30 seconds if user doesn't interact

## Context

### Depends on
- **T2250** (Write-Back R2 Sync) — introduces the data loss window this task detects

### Related
- Credit system (`user_db.py`, `creditStore.js`) — uses existing grant infrastructure
- `syncStore.js` — existing sync status tracking, extend with version tracking

### Risks
- False positives: version gap from normal operations (should not happen if graceful shutdown syncs correctly in T2250)
- Credit abuse: user intentionally crashes machine to get free credits. Mitigated by: credits are small (10-30), the scenario is hard to trigger intentionally, and we can cap grants per user per day.

## Implementation

### Steps
1. [ ] Add `X-DB-Version` header to middleware responses (read from local version cache)
2. [ ] Frontend: track `lastConfirmedVersion` from response headers
3. [ ] Frontend: on reconnect/data-fetch, compare versions and detect gap
4. [ ] Backend: `POST /api/internal/data-loss-recovery` endpoint with credit grant
5. [ ] Frontend: call recovery endpoint on detection, show notification with credit amount
6. [ ] Frontend: notification UI (toast, dismissable, expandable "what happened")
7. [ ] Backend: WARNING-level logging for data loss events
8. [ ] Add daily cap on data loss credits per user (e.g., max 50 credits/day)
9. [ ] Test: simulate crash (kill machine), verify detection on reconnect
10. [ ] Test: verify credits granted and notification shown
11. [ ] Test: verify idempotency (refresh doesn't double-grant)

## Acceptance Criteria

- [ ] Data loss detected within one request of reconnecting to a new machine
- [ ] User sees clear, non-blocking notification explaining what happened
- [ ] Credits auto-granted proportional to estimated lost editing time
- [ ] Credit grant is idempotent (refresh/retry doesn't double-grant)
- [ ] Daily credit cap prevents abuse
- [ ] Data loss events logged at WARNING level for monitoring
- [ ] No false positives during normal deploys (graceful shutdown syncs first)
