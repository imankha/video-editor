# Stage 5: Automated Testing

## Purpose

Run automated tests to verify the implementation, then expand test coverage to be comprehensive. The Tester agent runs relevant tests and iterates with the main AI until all tests pass.

## Checklist

### 1. Run Tester Agent (Phase 2)

**Spawn the Tester agent** to run tests:

```
Use Task tool with subagent_type: general-purpose

Prompt: See .claude/agents/tester.md Phase 2 template

Include:
- Task ID and title
- Test files created in Stage 3 (test-first)
- Any additional tests identified during implementation
- Request: run tests, analyze failures, provide fix suggestions
```

### 2. Fix Failures (Iterate)

For each failing test:

1. **Tester reports failure** with:
   - Test name and file
   - Error message
   - Expected vs actual
   - Suggested fix

2. **Main AI fixes the code**:
   - Apply the suggested fix
   - Or diagnose a different root cause
   - Commit the fix

3. **Re-run Tester** until all tests pass

### 3. Expand Test Coverage

**After all initial tests pass, add comprehensive unit tests for full coverage.**

Write tests covering:

**Backend (for each new endpoint/service function):**
- Happy path with valid inputs
- Error cases (404, validation errors, auth failures)
- Edge cases (duplicates, empty inputs, null fields)
- Integration between layers (endpoint -> service -> DB)
- Side effects (emails sent, records created in related tables)
- Deduplication / idempotency behavior

**Frontend (for each new component):**
- Renders correctly with default props
- Renders correctly with edge-case props (empty arrays, null values, single items)
- User interactions trigger correct behavior (clicks, input, keyboard)
- API calls made with correct parameters
- Success/error/loading states
- Dismiss/close behavior (Escape, backdrop click, X button, Cancel)
- Callbacks invoked with correct arguments

**Target:** Every new function, endpoint, and component should have tests for its primary behaviors AND its failure modes. Aim for the test plan items in the kickoff prompt plus any additional cases discovered during implementation.

**Run all tests after expansion:**
```bash
# Frontend
cd src/frontend && npm test

# Backend
cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_{feature}.py -v
```

Fix any failures, then commit the test expansion.

### 4. All Tests Pass

Once all tests pass (including expanded coverage):

```markdown
## Automated Testing Results

**Tests Run:**
- Frontend unit: X passed
- E2E: Y passed
- Backend: Z passed

**All tests passing.** Ready for testing handoff.
```

### 5. Commit Final State

Ensure all fixes are committed:

```bash
git status  # Should be clean
git log --oneline -5  # Review recent commits
```

---

## Test Commands Reference

```bash
# Frontend unit tests
cd src/frontend && npm test

# Specific test file
cd src/frontend && npm test -- src/components/Foo.test.jsx

# E2E tests
cd src/frontend && npm run test:e2e

# Specific E2E spec
cd src/frontend && npm run test:e2e -- tests/foo.spec.js

# Backend tests
cd src/backend && .venv/Scripts/python.exe run_tests.py

# Specific backend test
cd src/backend && pytest tests/test_foo.py -v
```

---

## After All Tests Pass

Proceed to [6-manual-testing.md](6-manual-testing.md) to generate the testing handoff prompt.
