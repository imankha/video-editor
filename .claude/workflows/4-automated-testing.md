# Stage 4: Automated Testing

## Purpose

Run automated tests to verify the implementation. The Tester agent runs relevant tests and iterates with the main AI until all tests pass.

## Checklist

### 1. Run Tester Agent (Phase 2)

**Spawn the Tester agent** to run tests:

```
Use Task tool with subagent_type: general-purpose

Prompt: See .claude/agents/tester.md Phase 2 template

Include:
- Task ID and title
- Test files created in Stage 2 (test-first)
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

### 3. All Tests Pass

Once Tester confirms all tests pass:

```markdown
## Automated Testing Results

**Tests Run:**
- Frontend unit: X passed
- E2E: Y passed
- Backend: Z passed

**All tests passing.** Ready for manual testing.
```

### 4. Commit Final State

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

Proceed to [5-manual-testing.md](5-manual-testing.md) to prepare for user testing.
