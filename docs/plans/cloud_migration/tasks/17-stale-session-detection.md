# Task 17: Stale Session Detection & Conflict Rejection

## Overview
Upgrade the current "last-write-wins" behavior to reject writes from stale sessions, showing the user a clear UI to refresh and recover.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 12 complete (Production deployment live)
- Multiple instances possible (Fly.io can scale)

## Testability
**After this task**: Opening two tabs, making changes in both, the second tab's save is rejected and shows a clear error with refresh option.

---

## Current Behavior (Problem)

```python
# storage.py lines 303-312
if r2_version > current_version:
    logger.warning(f"DB sync conflict... Using last-write-wins.")
    # Proceeds to upload anyway - data loss!
```

When two sessions write:
1. Tab A loads version 5
2. Tab B loads version 5
3. Tab A saves → version 6
4. Tab B saves → **overwrites to version 7, Tab A's changes lost**

---

## Target Behavior

```
Tab A saves v5→v6:  SUCCESS
Tab B tries v5→v6:  REJECTED (409 Conflict)
                    ↓
              Frontend shows:
              ┌─────────────────────────────────────────┐
              │ ⚠ Your session is out of date          │
              │                                         │
              │ Another session made changes. Your      │
              │ unsaved work cannot be applied.         │
              │                                         │
              │ [Refresh to get latest] [Copy my work]  │
              └─────────────────────────────────────────┘
```

---

## Implementation

### 1. Backend: Reject Stale Writes

**Modified: storage.py**

```python
class StaleSessionError(Exception):
    """Raised when trying to sync with outdated data."""
    def __init__(self, local_version: int, remote_version: int):
        self.local_version = local_version
        self.remote_version = remote_version
        super().__init__(
            f"Stale session: local version {local_version}, "
            f"remote version {remote_version}"
        )


def sync_database_to_r2_with_version(
    user_id: str,
    local_db_path: Path,
    current_version: Optional[int]
) -> Tuple[bool, Optional[int]]:
    """Upload database to R2, rejecting stale sessions."""
    # ... existing setup ...

    r2_version = get_db_version_from_r2(user_id)

    # CHANGED: Reject instead of last-write-wins
    if r2_version is not None and current_version is not None:
        if r2_version > current_version:
            logger.warning(
                f"Rejecting stale sync for {user_id}: "
                f"loaded v{current_version}, R2 has v{r2_version}"
            )
            raise StaleSessionError(current_version, r2_version)

    # ... rest of upload logic ...
```

### 2. Backend: Middleware Returns 409

**Modified: middleware/db_sync.py**

```python
from starlette.responses import JSONResponse
from ..storage import StaleSessionError

class DatabaseSyncMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # ... existing setup ...

        try:
            init_request_context()
            response = await call_next(request)

            if get_request_has_writes():
                sync_db_to_cloud_if_writes()

            return response

        except StaleSessionError as e:
            # Return 409 Conflict with details
            logger.warning(f"Stale session rejected: {e}")
            return JSONResponse(
                status_code=409,
                content={
                    "error": "stale_session",
                    "message": "Your session is out of date. Please refresh.",
                    "local_version": e.local_version,
                    "remote_version": e.remote_version,
                }
            )

        except Exception as e:
            # ... existing error handling ...
```

### 3. Frontend: Global Error Handler

**New: hooks/useStaleSessionHandler.js**

```javascript
import { useEffect, useState } from 'react';
import { useNavigationStore } from '../stores/navigationStore';

export function useStaleSessionHandler() {
  const [staleSession, setStaleSession] = useState(null);

  useEffect(() => {
    // Intercept all fetch responses
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      if (response.status === 409) {
        const data = await response.clone().json();
        if (data.error === 'stale_session') {
          setStaleSession({
            localVersion: data.local_version,
            remoteVersion: data.remote_version,
          });
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const clearStaleSession = () => setStaleSession(null);

  const refreshSession = () => {
    // Clear local state and reload
    window.location.reload();
  };

  return { staleSession, clearStaleSession, refreshSession };
}
```

### 4. Frontend: Stale Session Banner

**New: components/StaleSessionBanner.jsx**

```jsx
import React from 'react';
import { useStaleSessionHandler } from '../hooks/useStaleSessionHandler';

export function StaleSessionBanner() {
  const { staleSession, refreshSession } = useStaleSessionHandler();

  if (!staleSession) return null;

  return (
    <div className="stale-session-banner">
      <div className="stale-session-content">
        <span className="stale-session-icon">⚠</span>
        <div className="stale-session-text">
          <strong>Your session is out of date</strong>
          <p>Another session made changes. Your unsaved work cannot be saved.</p>
        </div>
        <button onClick={refreshSession} className="stale-session-refresh">
          Refresh to get latest
        </button>
      </div>
    </div>
  );
}
```

**Add to App.jsx:**

```jsx
import { StaleSessionBanner } from './components/StaleSessionBanner';

function App() {
  return (
    <>
      <StaleSessionBanner />
      {/* ... rest of app ... */}
    </>
  );
}
```

### 5. Frontend: CSS

```css
.stale-session-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #fef3cd;
  border-bottom: 2px solid #ffc107;
  padding: 12px 20px;
  z-index: 10000;
  display: flex;
  justify-content: center;
}

.stale-session-content {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 800px;
}

.stale-session-icon {
  font-size: 24px;
}

.stale-session-text p {
  margin: 4px 0 0 0;
  font-size: 14px;
  color: #856404;
}

.stale-session-refresh {
  background: #ffc107;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  white-space: nowrap;
}

.stale-session-refresh:hover {
  background: #e0a800;
}
```

---

## Tests

### Backend Unit Test

**New: tests/test_stale_session.py**

```python
import pytest
from app.storage import (
    sync_database_to_r2_with_version,
    StaleSessionError,
    get_db_version_from_r2,
)
from unittest.mock import patch, MagicMock


def test_rejects_stale_session():
    """Sync should raise StaleSessionError when R2 has newer version."""
    with patch('app.storage.get_db_version_from_r2', return_value=10):
        with patch('app.storage.get_r2_client') as mock_client:
            mock_client.return_value = MagicMock()

            with pytest.raises(StaleSessionError) as exc_info:
                sync_database_to_r2_with_version(
                    user_id="test",
                    local_db_path=Path("/tmp/test.db"),
                    current_version=5  # Older than R2's 10
                )

            assert exc_info.value.local_version == 5
            assert exc_info.value.remote_version == 10


def test_accepts_current_version():
    """Sync should succeed when local version matches R2."""
    # ... test that version 5 → 6 works when R2 is at 5


def test_accepts_newer_local_version():
    """Edge case: local somehow ahead of R2 (first sync)."""
    # ... test that version 5 works when R2 is at None
```

### E2E Test

**New: e2e/stale-session.spec.js**

```javascript
import { test, expect } from '@playwright/test';

test.describe('Stale Session Detection', () => {
  test('shows banner when session becomes stale', async ({ browser }) => {
    // Open two browser contexts (simulates two tabs)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Both load the app
    await pageA.goto('http://localhost:5173');
    await pageB.goto('http://localhost:5173');

    // Both create a project (loads same DB version)
    // ...

    // Tab A makes a change and saves
    await pageA.click('[data-testid="save-button"]');
    await expect(pageA.locator('.save-success')).toBeVisible();

    // Tab B tries to save - should see stale banner
    await pageB.click('[data-testid="save-button"]');
    await expect(pageB.locator('.stale-session-banner')).toBeVisible();
    await expect(pageB.locator('.stale-session-banner')).toContainText(
      'Your session is out of date'
    );

    // Tab B clicks refresh
    await pageB.click('.stale-session-refresh');
    // Page reloads, banner gone, has latest data
    await expect(pageB.locator('.stale-session-banner')).not.toBeVisible();

    await contextA.close();
    await contextB.close();
  });
});
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| First user ever (no R2 DB) | Upload succeeds (v1) |
| User A and B load, only A saves | A succeeds, B stale if B saves later |
| User saves, then saves again | Works (version increments each time) |
| R2 unavailable | Falls back to local, no conflict check |
| Page refresh after stale | Gets latest data, can save normally |

---

## Deliverables

| Item | Description |
|------|-------------|
| StaleSessionError exception | Raised when sync rejected |
| Middleware 409 response | Returns structured error |
| useStaleSessionHandler hook | Intercepts 409, tracks state |
| StaleSessionBanner component | User-facing error UI |
| Backend unit tests | Test rejection logic |
| E2E test | Simulates two-tab conflict |

---

## Optional Enhancement: Copy Unsaved Work

For better UX, add "Copy my changes" button that:
1. Serializes current unsaved state to clipboard
2. Shows "Copied! You can paste after refreshing"
3. User refreshes, pastes, re-applies changes manually

This is more complex (requires tracking dirty state) - could be a follow-up.

---

## Next Step
Task 13 - User Management (optional) or continue to Phase 4
