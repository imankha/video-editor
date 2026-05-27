# T3150: Fix Backend NULL Storage

**Epic:** [Bug Report Diagnostic Quality](EPIC.md)
**Status:** TODO
**Stack Layers:** Backend
**Files Affected:** 1 file
**LOC Estimate:** ~5 lines
**Test Scope:** Backend

## Problem

The backend INSERT for bug reports uses Python truthiness checks that treat empty collections as NULL:

```python
# src/backend/app/routers/auth.py:733-735
Json(body.editor_context) if body.editor_context else None,
Json(body.actions) if body.actions else None,
Json(body.logs) if body.logs else None,
```

In Python, `bool([])` is `False` and `bool({})` is `False`. So:
- `actions: []` (empty list) → stored as NULL
- `editor_context: {}` (empty dict) → stored as NULL
- `logs: []` (empty list) → stored as NULL

This means even after T3170/T3180 are deployed, edge cases where context/actions are empty would lose data.

## Fix

Change all three lines from `if body.X else None` to `if body.X is not None`:

```python
Json(body.editor_context) if body.editor_context is not None else None,
Json(body.actions) if body.actions is not None else None,
Json(body.logs) if body.logs is not None else None,
```

## File

- `src/backend/app/routers/auth.py` lines 733-735 (inside `report_problem` endpoint)

## Verification

1. Run backend import check: `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`
2. Confirm `Json([])` produces a valid JSONB value (empty array), not NULL
3. Run existing backend tests to ensure no regression

## Dependencies

None. This is a prerequisite for T3170 and T3180 -- without this fix, empty context/actions would still be stored as NULL even after those tasks add the capture code.
