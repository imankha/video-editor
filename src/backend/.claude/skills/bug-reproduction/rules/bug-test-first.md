# bug-test-first

**Priority:** CRITICAL
**Category:** Test First

## Rule

Never fix a bug without first writing a test that reproduces it and confirms it fails.

## Workflow

1. **Write test** that triggers the bug
2. **Run test** → Must FAIL (proves bug exists)
3. **Fix the bug**
4. **Run test** → Must PASS (proves fix works)
5. **Run all tests** → Must PASS (no regressions)

## Rationale

- **Proves understanding**: If you can't write a failing test, you don't understand the bug
- **Proves the fix**: A passing test proves your fix actually works
- **Prevents regression**: The test catches if the bug returns later
- **Documents behavior**: The test serves as documentation of the expected behavior

## Correct Example

```python
# Bug: "Projects endpoint returns 500 when user has no projects"

# Step 1: Write failing test
def test_projects_returns_empty_list_for_new_user(client, new_user):
    """New user with no projects should get empty list, not error."""
    response = client.get("/api/projects", headers={"X-User-ID": new_user.id})
    assert response.status_code == 200
    assert response.json() == []

# Step 2: Run test - FAILS with 500 error
# Step 3: Fix the bug in projects.py
# Step 4: Run test - PASSES
# Step 5: Run all tests - PASS
```

## Incorrect Example

```python
# BAD: Fixing without a test
"I looked at the code and added a null check, should be fixed now"

# Problems:
# - No proof the fix works
# - No protection against regression
# - May not have understood the actual bug
```

## Exception: UI-Only Bugs

If a bug truly cannot be tested programmatically:

1. Document why in the commit message
2. Add logging to detect recurrence
3. Create manual test steps

But always TRY to write a test first. Most bugs are testable.
