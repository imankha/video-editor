# T40: Single Active Session Handoff

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-05-01

## Problem

When a user signs in on a new device, the old device must be cleanly signed out and its local data synced to R2 before the new device begins editing. Without this, two scenarios cause data loss:

1. **Silent overwrite**: New device downloads stale R2 state while old device still has unsynced edits
2. **Two machines editing**: Both machines modify per-user SQLite concurrently, last-write-wins on R2

The old "stale session detection" design (409 Conflict, two-tab awareness) is obsoleted by single active session enforcement. Instead of detecting and warning about conflicts, we prevent them entirely: only one session is valid at a time.

## Solution

### Device Handoff Flow

```
Device A: editing on Machine 1
Device B: user signs in

1. POST /auth/login
   → Postgres: existing session for this user? → Yes (session_A on Machine 1)
   → Mark session_A as invalidated in Postgres
   → Create session_B for Device B → assigned to Machine 2

2. Device A's next API request
   → validate_session(session_A) → invalid (checked against Postgres)
   → Is user_id in _dirty_users? → Yes
   → Trigger sync-before-401:
     Success → clear dirty flag → return 401 { reason: "signed_in_elsewhere" }
     Failure → return 503 { reason: "sync_pending", retry_after: 5 }
     After 3 failures → accept loss, return 401, log data loss event

3. Device A frontend receives 401 { reason: "signed_in_elsewhere" }
   → Show "Signed in elsewhere" notification
   → Clean up local state (Zustand stores, auth context)
   → Redirect to login page

4. Device B: ensure_database()
   → Downloads latest from R2 (includes Machine 1's final sync if successful)
   → Editing continues with zero data loss
```

### Login-Time Session Invalidation

The login endpoint must check for and invalidate existing sessions:

```python
async def login(credentials):
    user = authenticate(credentials)

    # Check for existing active session
    existing = await pg.fetchrow(
        "SELECT session_id, machine_id FROM sessions WHERE user_id = $1 AND expires_at > now()",
        user.user_id
    )

    if existing:
        # Invalidate old session in Postgres
        await pg.execute(
            "UPDATE sessions SET expires_at = now() WHERE session_id = $1",
            existing['session_id']
        )
        # Old machine will discover this on next validate_session() call

    # Create new session
    new_session = create_session(user.user_id, machine_id=current_machine)
    return new_session
```

### Frontend: Signed-Out-Elsewhere Detection

Every API response is checked. When a 401 with `reason: "signed_in_elsewhere"` is received:

```javascript
// In API client (apiClient.js or similar)
async function handleResponse(response) {
  if (response.status === 401) {
    const data = await response.json();
    if (data.reason === 'signed_in_elsewhere') {
      showSignedOutNotification();
      clearLocalState();
      redirectToLogin();
      return;
    }
    // Normal 401 (expired session) — redirect to login without notification
    redirectToLogin();
  }
  if (response.status === 503 && data?.reason === 'sync_pending') {
    // Old device: sync in progress, retry the request
    await sleep(data.retry_after * 1000);
    return fetch(response.url, originalOptions);
  }
}
```

### Frontend: "Signed Out Elsewhere" Notification

Non-modal, clear, non-alarming:

```
┌─────────────────────────────────────────────────────┐
│  You've been signed out                             │
│                                                     │
│  You signed in on another device. Your work has     │
│  been saved.                                        │
│                                                     │
│  [Sign in again]                                    │
└─────────────────────────────────────────────────────┘
```

- Shown as a full-page state (replaces app content), not a toast — the session is dead
- "Your work has been saved" only if sync succeeded (401 implies sync completed)
- If data loss occurred (401 after 3 sync failures), T2260 handles the credit + notification on the *new* device's next load

### Sync Failure Handling

The sync-before-401 mechanism (implemented in T2250's middleware) has three outcomes:

| Sync result | Response to old device | Data state |
|-------------|----------------------|------------|
| Success | 401 `{ reason: "signed_in_elsewhere" }` | R2 has latest. New device safe. |
| Retry (1-2 failures) | 503 `{ reason: "sync_pending", retry_after: 5 }` | Keep session alive temporarily. Old device retries. |
| Exhausted (3 failures) | 401 `{ reason: "signed_in_elsewhere", data_loss: true }` | R2 is stale. T2260 detects gap on new device. |

The `data_loss: true` flag tells the old device's notification to say "Some recent edits may not have been saved" instead of "Your work has been saved."

## Changes

### Backend

**Login endpoint (`auth.py`):**
- On successful login: query Postgres for existing active sessions for this user
- If found: update `expires_at = now()` to invalidate
- Create new session as normal
- No need to notify old machine — it discovers invalidation on its next `validate_session()` call

**`validate_session()` response (`middleware/db_sync.py`):**
- Already planned in T2250: sync-before-401 for dirty users
- Add `data_loss: true` to 401 JSON body when sync failed after retries
- Track retry count per session invalidation (in-memory counter, cleared on success or session cleanup)

### Frontend

**API client (`apiClient.js` or axios interceptor):**
- Intercept 401 responses globally
- Check for `reason: "signed_in_elsewhere"` in response body
- On match: trigger signed-out-elsewhere flow instead of normal auth redirect
- Intercept 503 with `reason: "sync_pending"` — auto-retry with backoff

**Signed-out page/overlay:**
- Full-page overlay replacing app content
- Clear message: "You signed in on another device"
- Conditional text based on `data_loss` flag
- "Sign in again" button → login page

**State cleanup:**
- Clear Zustand stores (auth, clips, projects, etc.)
- Clear session cookie (or let redirect handle it)
- No need to clear IndexedDB/localStorage — new session loads fresh from R2

## Context

### Depends on
- **T1190** (Session & Machine Pinning) — provides session validation against Postgres, single-session enforcement
- **T2250** (Write-Back R2 Sync) — provides sync-before-401 mechanism in middleware, dirty user tracking

### Enables
- **T2260** (Data Loss Detection & Recovery) — T2260 is the fallback when the sync-before-401 in this flow fails. This task produces the `data_loss: true` signal that T2260 detects on the new device.

### What this task does NOT cover
- Machine pinning / fly-replay routing (T1190)
- Periodic sync, sign-out sync, dirty tracking (T2250)
- Credit grants and data loss notification on new device (T2260)
- Two-tab conflict within the same session (not a problem — same machine, same SQLite file, no R2 race)

## Implementation

### Steps
1. [ ] Backend: add existing-session check + invalidation to login endpoint
2. [ ] Backend: add `data_loss: true` field to 401 response when sync-before-401 exhausts retries
3. [ ] Frontend: global 401 interceptor distinguishes `signed_in_elsewhere` from normal auth expiry
4. [ ] Frontend: global 503 interceptor for `sync_pending` — auto-retry with backoff
5. [ ] Frontend: signed-out-elsewhere full-page overlay with conditional messaging
6. [ ] Frontend: state cleanup on forced sign-out (Zustand stores, auth context)
7. [ ] Test: login on Device B invalidates Device A's session in Postgres
8. [ ] Test: Device A's next request triggers sync-before-401 and returns 401
9. [ ] Test: Device A frontend shows "signed in elsewhere" page
10. [ ] Test: Device B downloads latest data from R2 after Device A syncs
11. [ ] Test: sync failure path — 503 retry, then 401 with data_loss after exhaustion

## Acceptance Criteria

- [ ] New login invalidates any existing active session for the same user
- [ ] Old device receives 401 with `reason: "signed_in_elsewhere"` (not a generic 401)
- [ ] Old device's local data synced to R2 before 401 is returned (when possible)
- [ ] If sync fails, old device sees 503 with retry (up to 3 attempts)
- [ ] After sync retry exhaustion, 401 includes `data_loss: true` flag
- [ ] Frontend shows clear "signed in elsewhere" message, not a confusing error
- [ ] Frontend cleans up local state on forced sign-out
- [ ] New device gets latest data from R2 on sign-in
- [ ] Two-tab same-device editing is unaffected (no 409, no conflict detection)
