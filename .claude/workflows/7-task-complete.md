# Stage 7: Task Complete

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

### 2. Test Evidence Gate

Before declaring complete, show actual test output (pass/fail counts from the real run), not a claim that tests pass. If any test was skipped or is flaky, say so explicitly. A task without test evidence is not complete.

### 3. Update the Knowledge Base

Update the `.claude/knowledge/*.md` doc(s) for every domain this task touched:
- [ ] New/moved entry points, changed data flow
- [ ] Invariants added or removed
- [ ] Landmines discovered during the task (the thing that cost you an hour goes here)
- [ ] Move the task from "Active/upcoming work" to a one-line entry in "Landmines & history" if it changed behavior
- [ ] Prune any lines the task made stale

This is how the next agent skips re-exploration. Commit the knowledge-doc edits with the task.

### 4. Commit Final Changes

Stage explicit paths (never `git add -A` / `git add .` — the working tree is shared and may hold unrelated WIP).

```bash
git add <changed files>
git commit -m "$(cat <<'EOF'
T{id}: {final cleanup summary}

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Do NOT mark the task DONE in this commit. DONE is a user promotion (see CLAUDE.md Task Status Rule).

### 5. Notify User



```
T{id} complete. Branch `feature/T{id}-*` is ready to merge.
```

---

## Merge -> STAGING

The user reviews and decides when to merge. When the task branch lands on master — whether AI performs the merge (only when the user explicitly asks) or AI confirms the user merged it — set that task's Status to `STAGING` in `docs/plans/PLAN.md`. Pushing to master auto-deploys staging, so STAGING is factually true at that point (AI owns this status; see CLAUDE.md Task Status Rule).

After merge the user will (optionally) delete the feature branch, verify on staging, then promote `STAGING -> DONE` via the task board "Resolve" button. Being on staging is the test phase — there is no separate TESTING step.

**AI does NOT push or merge to master unless the user explicitly asks** (see [No merge without approval] memory).

---

## Summary

The full workflow completed:
1. **Task Start** - Branch created, Code Expert audited codebase
2. **Architecture** - Design doc created, user approved
3. **Test First** - Failing tests created for acceptance criteria
4. **Implementation** - Code written following approved design
5. **Automated Testing** - Tester ran tests, all passing
6. **Manual Testing** - User verified feature works
7. **Task Complete** - Cleanup done, ready for merge
