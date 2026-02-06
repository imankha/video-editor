---
name: bug-reproduction
description: "Test-first bug fixing workflow. When a bug is reported, first write a failing test that reproduces it, then fix the bug and verify the test passes. Never fix bugs without a reproducing test."
license: MIT
author: video-editor
version: 1.0.0
---

# Bug Reproduction Workflow

When fixing bugs, always write a failing test first. This ensures:
1. We understand the bug correctly
2. The fix actually works
3. The bug never regresses

## When to Apply

- User reports a bug
- You discover unexpected behavior
- A test is flaky (reproduce the flake)
- Debugging production issues

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Test First | CRITICAL | `bug-test-` |

---

## The Workflow

```
Bug Reported
    │
    ▼
1. UNDERSTAND: What is the expected vs actual behavior?
    │
    ▼
2. REPRODUCE: Can you trigger the bug manually?
    │
    ▼
3. WRITE TEST: Create a test that reproduces the bug
    │
    ▼
4. CONFIRM FAIL: Run test, verify it FAILS (proves bug exists)
    │
    ▼
5. FIX: Implement the fix
    │
    ▼
6. CONFIRM PASS: Run test, verify it PASSES (proves fix works)
    │
    ▼
7. RUN ALL TESTS: Ensure no regressions
```

## Test Location

Place bug reproduction tests near the code they test:

```
src/backend/
├── app/
│   └── routers/
│       └── games.py
└── tests/
    └── test_games.py      ← Bug test goes here
```

## Test Naming

Name tests to describe the bug:

```python
# Good: Describes the bug scenario
def test_games_list_returns_empty_when_user_has_no_games():
    ...

def test_export_progress_does_not_reset_on_websocket_reconnect():
    ...

# Bad: Vague names
def test_games_bug():
    ...

def test_fix():
    ...
```

---

## Example Workflow

### Bug Report
> "When I load projects, it takes 20 seconds"

### Step 1: Understand
- Expected: Projects load in <1s
- Actual: Takes 20s

### Step 2: Reproduce
```bash
# Manual reproduction
curl -w "%{time_total}s" http://localhost:8000/api/projects
# Output: 20.5s
```

### Step 3: Write Failing Test
```python
# tests/test_performance.py
import time
import pytest

def test_projects_endpoint_responds_quickly(client):
    """Projects endpoint should respond in under 1 second."""
    start = time.time()
    response = client.get("/api/projects")
    elapsed = time.time() - start

    assert response.status_code == 200
    assert elapsed < 1.0, f"Projects took {elapsed:.2f}s, expected <1s"
```

### Step 4: Confirm Fail
```bash
pytest tests/test_performance.py -v
# FAILED: Projects took 20.19s, expected <1s
```

### Step 5: Fix
```python
# Fix the slow code...
```

### Step 6: Confirm Pass
```bash
pytest tests/test_performance.py -v
# PASSED
```

### Step 7: Run All Tests
```bash
.venv/Scripts/python.exe run_tests.py
# All tests pass
```

---

## When You Can't Write a Test

Sometimes bugs are hard to test (UI-only, timing-dependent, etc.). In these cases:

1. **Document why** a test isn't feasible
2. **Add logging** to detect if the bug recurs
3. **Create a manual test checklist** in the PR/commit

But always try to write a test first. Most bugs ARE testable.

---

## Common Bug Test Patterns

### Race Condition
```python
import asyncio

async def test_no_race_condition_on_concurrent_writes():
    """Two concurrent writes should not lose data."""
    async def write_a():
        await client.post("/api/data", json={"key": "a"})

    async def write_b():
        await client.post("/api/data", json={"key": "b"})

    await asyncio.gather(write_a(), write_b())

    result = await client.get("/api/data")
    assert "a" in result.json()
    assert "b" in result.json()
```

### Null/Missing Data
```python
def test_handles_missing_optional_field():
    """Should not crash when optional field is missing."""
    response = client.post("/api/clips", json={
        "name": "test",
        # "description" intentionally omitted
    })
    assert response.status_code == 200
```

### Edge Cases
```python
def test_handles_empty_list():
    """Should return empty array, not error, when no items."""
    response = client.get("/api/games")
    assert response.status_code == 200
    assert response.json() == []
```

---

## Complete Rules

See individual rule files in `rules/` directory.
