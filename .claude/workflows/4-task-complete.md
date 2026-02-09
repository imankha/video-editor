# Stage 4: Task Complete

## Checklist After User Approval

### 1. Final Cleanup

**Remove any remaining artifacts:**
- [ ] Implementation comments (e.g., `// T06: moved here`)
- [ ] Temporary logging added during development
- [ ] Debug variables or test data
- [ ] Unused imports from refactoring

**Verify clean code:**
```bash
# Frontend - check for console.log
grep -r "console.log" src/frontend/src --include="*.jsx" --include="*.js"

# Backend - check for print statements
grep -r "print(" src/backend/app --include="*.py"
```

### 2. Update Task Status to DONE

Edit `docs/plans/tasks/T{id}-*.md`:
```markdown
**Status:** DONE
**Updated:** {today's date}
```

Mark implementation items complete:
```markdown
## Implementation
1. [x] Step one
2. [x] Step two
3. [x] Step three
```

### 3. Update PLAN.md

Edit `docs/plans/PLAN.md`:
```markdown
| T{id} | [Task Name](tasks/T{id}-*.md) | DONE | ... |
```

### 4. Commit Cleanup Changes

```bash
git add -A
git commit -m "docs: Mark T{id} as DONE"
```

### 5. Prep for Merge

Verify branch is ready:
```bash
git status          # Clean working tree
git log --oneline   # Review commits
```

Tell user the branch is ready:
```
T{id} complete. Branch `feature/T{id}-*` is ready to merge.
```

---

## User Handles Merge

The user will:
1. Review the branch
2. Merge to master
3. Delete the feature branch

AI does NOT push or merge to master.
