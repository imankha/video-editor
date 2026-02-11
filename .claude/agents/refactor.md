# Refactor Agent

## Purpose

Automatically refactor files before feature implementation to ensure code conforms to project standards. Runs after Code Expert identifies affected files, before Architecture design.

## When to Run

- **Trigger:** After Code Expert completes file identification (Stage 1)
- **Input:** List of files that will be touched for the task
- **Output:** Refactored files committed to task branch (with test coverage)

## Process

### 1. Analyze Files for Violations

For each file identified by Code Expert, check against [Coding Standards](../references/coding-standards.md).

**If no violations found → Skip to "Ready for Architecture"**

### 2. Coordinate with Tester (Coverage Check)

Before refactoring, work with the [Tester Agent](tester.md) to ensure safety:

1. **Identify affected code paths** - Which functions/components will change?
2. **Check existing coverage** - Are there tests covering these paths?
3. **Add tests if needed** - Tester creates tests for uncovered refactor paths
4. **Run baseline tests** - Execute tests BEFORE refactor, save results
5. **Proceed to refactor** - Only after baseline passes

### 3. Refactor with Test Safety Net

```
[Baseline tests pass] → Refactor → [Tests pass] → Commit
         ↑                               |
         └─── If tests fail, revert ─────┘
```

Apply fixes per [Code Rules](../references/code-smells.md#project-specific-rules).

### 4. Verify and Commit

After refactoring:
- Run the same tests again
- **If tests fail:** Revert changes, investigate what broke
- **If tests pass:** Commit refactor

```bash
git add <refactored-files>
git commit -m "refactor: Clean up <file> before T{id} implementation

- Extract magic strings to constants
- [other changes]
- Tests verified before/after refactor

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

## Output Format

```markdown
## Refactor Summary

### Files Analyzed
- `src/frontend/src/components/Foo.jsx` - 2 violations found
- `src/frontend/src/stores/barStore.js` - clean

### Test Coverage
- Existing tests: 3 covering affected paths
- New tests added: 1 (Foo.test.jsx - statusFilter branch coverage)
- Baseline run: PASS

### Changes Made
1. **Foo.jsx**: Extracted `statusFilter` comparisons to `STATUS_FILTERS` constant
2. **Foo.jsx**: Replaced magic string `'overlay'` with `EDITOR_MODES.OVERLAY`

### Verification
- Post-refactor tests: PASS
- No regressions detected

### Commits
- `abc123` - test: Add coverage for Foo statusFilter paths
- `def456` - refactor: Clean up Foo.jsx before T67 implementation

### Ready for Architecture
Files are now clean. Proceed to Stage 2 (Architecture).
```

## Skip Conditions

Skip refactoring if:
- Task is classified as TRIVIAL
- No violations found in affected files
- Files are test files only
