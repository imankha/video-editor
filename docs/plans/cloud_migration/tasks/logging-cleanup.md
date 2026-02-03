# Logging Cleanup

## Problem Statement

The codebase has accumulated debug logging during development that needs to be cleaned up before staging/production:
- Verbose debug statements that clutter logs
- Inconsistent log levels (INFO vs DEBUG vs WARNING)
- Missing useful logs for production monitoring
- Potentially sensitive data in logs

## Goals

1. **Remove noise** - Delete or downgrade excessive debug logs
2. **Standardize levels** - Consistent use of DEBUG/INFO/WARNING/ERROR
3. **Add useful logs** - Ensure key operations are logged for production monitoring
4. **Protect sensitive data** - No passwords, tokens, or PII in logs

## Log Level Guidelines

| Level | When to Use | Examples |
|-------|-------------|----------|
| **DEBUG** | Development only, verbose details | Variable values, loop iterations |
| **INFO** | Normal operations worth noting | Request start/end, job completion |
| **WARNING** | Unexpected but handled | Retry attempts, fallback used, slow operations |
| **ERROR** | Failures requiring attention | Exceptions, failed jobs, data issues |

## Areas to Review

### Backend

#### 1. Modal Client (`modal_client.py`)
- [ ] Progress simulation logs - downgrade to DEBUG
- [ ] Job spawn/completion - keep as INFO
- [ ] Errors - ensure ERROR level with context

#### 2. Export Routes (`routers/export/*.py`)
- [ ] Request start/end - INFO
- [ ] Parameter details - DEBUG only
- [ ] Export completion - INFO with job_id and duration

#### 3. Database Sync (`storage.py`)
- [ ] Sync start/end - DEBUG (too frequent for INFO)
- [ ] Slow sync warnings - keep as WARNING
- [ ] Sync conflicts - WARNING with versions

#### 4. R2 Operations
- [ ] Upload/download - DEBUG
- [ ] Presigned URL generation - DEBUG
- [ ] Errors - ERROR with bucket/key

#### 5. WebSocket (`services/export_worker.py`)
- [ ] Connection open/close - DEBUG
- [ ] Progress updates - DEBUG (very frequent)
- [ ] Errors - ERROR

### Frontend

#### 1. Console Logs
- [ ] Remove `console.log` debug statements
- [ ] Keep `console.error` for actual errors
- [ ] Consider using a logging utility that can be disabled in production

#### 2. Network Logging
- [ ] Remove request/response logging
- [ ] Keep error logging

## Implementation

### Backend: Logging Configuration

```python
# app/logging_config.py
import logging
import os

def configure_logging():
    """Configure logging based on environment."""
    level = logging.DEBUG if os.getenv("DEBUG") else logging.INFO

    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Quiet noisy libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("modal").setLevel(logging.WARNING)
```

### Backend: Log Audit Script

```bash
# Find all logging statements
grep -rn "logger\." src/backend/app/ --include="*.py" | head -50
grep -rn "logging\." src/backend/app/ --include="*.py" | head -50
grep -rn "print(" src/backend/app/ --include="*.py" | head -50
```

### Frontend: Console Audit Script

```bash
# Find all console statements
grep -rn "console\." src/frontend/src/ --include="*.js" --include="*.jsx" | head -50
```

## Checklist

### Backend Cleanup
- [ ] Audit all `logger.debug()` calls - are they useful?
- [ ] Audit all `logger.info()` calls - should any be DEBUG?
- [ ] Audit all `print()` statements - convert to logger or remove
- [ ] Add structured fields to logs (job_id, user_id, duration)
- [ ] Remove any sensitive data from logs

### Frontend Cleanup
- [ ] Remove development `console.log` statements
- [ ] Keep error boundary logging
- [ ] Consider conditional logging based on environment

### Production Readiness
- [ ] Verify log output is parseable (for log aggregation)
- [ ] Test that DEBUG logs don't appear with DEBUG=false
- [ ] Ensure slow operation warnings still appear
- [ ] Verify error logs have enough context to debug

## Files to Audit

| File | Priority | Notes |
|------|----------|-------|
| `modal_client.py` | High | Lots of progress logging |
| `export_worker.py` | High | WebSocket events |
| `storage.py` | Medium | DB sync operations |
| `multi_clip.py` | Medium | Export flow |
| `framing.py` | Medium | Export flow |
| `overlay.py` | Medium | Export flow |
| Frontend components | Medium | Console statements |

## Success Criteria

- [ ] No `print()` statements in backend code
- [ ] No unnecessary `console.log` in frontend (prod build)
- [ ] All logs have appropriate level
- [ ] Key operations logged at INFO level
- [ ] Errors have actionable context
- [ ] No sensitive data in logs
