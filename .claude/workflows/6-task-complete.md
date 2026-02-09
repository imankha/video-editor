# Stage 6: Task Complete

## Purpose

Finalize the task after user approval. Clean up any remaining artifacts and prepare the branch for merge.

## Checklist

### 1. Final Cleanup

**Remove any remaining artifacts:**
- [ ] Implementation comments (e.g., `// T06: moved here`)
- [ ] Temporary logging added during development
- [ ] Debug variables or test data
- [ ] Unused imports from refactoring

**Verify clean code:**
```bash
# Check for console.log (frontend)
grep -r "console.log" src/frontend/src --include="*.jsx" --include="*.js" | grep -v node_modules | grep -v ".test."

# Check for print statements (backend)
grep -r "print(" src/backend/app --include="*.py" | grep -v "__pycache__"
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

### 4. Commit Final Changes

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: Mark T{id} as DONE

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

### 5. Notify User

```
T{id} complete. Branch `feature/T{id}-*` is ready to merge.
```

---

## User Handles Merge

The user will:
1. Review the branch
2. Merge to master
3. Delete the feature branch (optional)

**AI does NOT push or merge to master.**

---

## Summary

The full workflow completed:
1. **Task Start** - Branch created, Code Expert audited codebase
2. **Test First** - Failing tests created for acceptance criteria
3. **Implementation** - Code written following guidelines
4. **Automated Testing** - Tester ran tests, all passing
5. **Manual Testing** - User verified feature works
6. **Task Complete** - Cleanup done, ready for merge
