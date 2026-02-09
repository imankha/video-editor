# Stage 2: Test First

## Purpose

Create failing tests before implementation. This ensures:
- Clear acceptance criteria in code form
- Tests verify the feature works when done
- TDD approach catches edge cases early

## Checklist

### 1. Run Tester Agent (Phase 1)

**Spawn the Tester agent** to analyze coverage and create tests:

```
Use Task tool with subagent_type: general-purpose

Prompt: See .claude/agents/tester.md Phase 1 template

Include:
- Task ID and title
- Acceptance criteria from task file
- Entry points from Code Expert report
- Request: find existing coverage, design new tests, write failing tests
```

The Tester will return:
- Existing tests that cover our code
- New test files/cases created
- Confirmation tests fail appropriately

### 2. Review Test Design

Before proceeding, verify the tests:
- Cover all acceptance criteria
- Follow existing test patterns
- Are minimal but complete
- Fail for the right reasons (not syntax errors)

### 3. Commit Failing Tests

```bash
git add -A
git commit -m "test: Add failing tests for T{id}

Tests for:
- [acceptance criterion 1]
- [acceptance criterion 2]

These tests will pass once the feature is implemented.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

### 4. Document Test Plan

Update task file Progress Log:

```markdown
**{date}**: Test-first phase complete.
- Existing coverage: [test files that already cover related code]
- New tests: [test files created]
- Tests verify: [what the tests check]
```

---

## Test File Locations

| Type | Location | Command |
|------|----------|---------|
| Frontend unit | `src/frontend/src/**/*.test.{js,jsx}` | `npm test` |
| E2E | `src/frontend/tests/**/*.spec.js` | `npm run test:e2e` |
| Backend | `src/backend/tests/**/*.py` | `run_tests.py` |

---

## After Completing This Stage

Proceed to [3-implementation.md](3-implementation.md) to write the code.
