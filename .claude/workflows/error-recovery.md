# Error Recovery Procedures

What to do when things go wrong during the workflow.

---

## Recovery by Scenario

### Design Rejected After Implementation Started

**Situation**: User rejects design after code has been written.

**Recovery**:
```bash
# 1. Stash current work
git stash save "T{id} implementation before design revision"

# 2. Return to Stage 2 (Architecture)
# Revise design based on feedback

# 3. After design approved, decide:
# Option A: Discard implementation, start fresh
git stash drop

# Option B: Apply stashed changes and modify
git stash pop
# Then adjust to match new design
```

**Prevention**: Ensure design is thoroughly reviewed before starting implementation.

---

### Tests Fail Repeatedly (3+ Attempts)

**Situation**: Implementation can't pass tests after multiple fix attempts.

**Recovery**:
```
1. Stop and assess:
   - Are tests correct?
   - Is design flawed?
   - Is implementation approach wrong?

2. If tests are wrong:
   - Fix tests, not implementation
   - Update Tester about correct behavior

3. If design is flawed:
   - Return to Stage 2 (Architecture)
   - Document what was learned
   - Revise design with new understanding

4. If implementation approach is wrong:
   - Try alternative approach from design doc
   - If none specified, consult Architect agent
```

**Escalation**: After 3 failed attempts, always pause and reassess design.

---

### Implementation Deviates Significantly from Design

**Situation**: Reviewer finds major deviations.

**Recovery**:
```
1. Assess deviation:
   - Was it necessary? (discovered issue during implementation)
   - Was it accidental? (misread design)

2. If necessary deviation:
   - Document the reason
   - Update design doc with actual approach
   - Get user approval for design change
   - Continue with review

3. If accidental deviation:
   - Revert to match design
   - Re-review after fix
```

---

### Merge Conflict with Master

**Situation**: Feature branch conflicts with changes merged to master.

**Recovery**:
```bash
# 1. Update master
git checkout master
git pull

# 2. Rebase feature branch
git checkout feature/T{id}-*
git rebase master

# 3. Resolve conflicts
# - Prefer master for unrelated changes
# - Prefer feature for task-specific changes
# - Ask user if unclear

# 4. Re-run tests after rebase
npm test
npm run test:e2e

# 5. If tests fail, may need to adjust implementation
```

---

### Agent Returns Unusable Output

**Situation**: Agent output is incomplete, wrong, or confusing.

**Recovery**:
```
1. Don't use bad output

2. Re-run agent with:
   - More specific prompt
   - Additional context
   - Clarified requirements

3. If still failing:
   - Break task into smaller pieces
   - Handle problematic part manually
   - Document issue for retrospective
```

---

### User Unavailable for Approval

**Situation**: Workflow blocked at approval gate, user not responding.

**Recovery**:
```
1. Document current state clearly
2. Commit all work in progress
3. Create detailed handoff notes:
   - What was done
   - What needs approval
   - What's next after approval
4. Wait for user (don't proceed without approval)
```

---

### Build/Lint Errors After Changes

**Situation**: Code won't build or lint fails.

**Recovery**:
```bash
# 1. Check the error
npm run build 2>&1 | head -50

# 2. Common fixes:
# - Missing import: Add it
# - Unused import: Remove it
# - Type error: Fix the type
# - Syntax error: Fix syntax

# 3. After fix, verify
npm run build
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"

# 4. If error is in unchanged code:
# - May be pre-existing issue
# - May be dependency issue
# - Flag to user, don't mask with workarounds
```

---

### Lost Context / Conversation Reset

**Situation**: New conversation, need to resume task.

**Recovery**:
```
1. Read task file: docs/plans/tasks/T{id}-*.md
   - Check current status
   - Read progress log

2. Read design doc (if exists): docs/plans/tasks/T{id}-design.md

3. Check git status:
   git branch  # Confirm on feature branch
   git log --oneline -5  # See recent commits
   git status  # See uncommitted changes

4. Determine current stage from status:
   - TODO → Stage 1
   - IN_PROGRESS → Check progress log for stage
   - TESTING → Stage 6
   - DONE → Stage 7 (cleanup)

5. Resume from that stage
```

---

## Prevention Checklist

### Before Implementation
- [ ] Design thoroughly reviewed
- [ ] All questions answered
- [ ] Scope is clear and bounded

### During Implementation
- [ ] Commit frequently (can revert)
- [ ] Run tests often (catch issues early)
- [ ] Follow design exactly (minimize surprises)

### Before Testing
- [ ] All changes committed
- [ ] Build passes
- [ ] Lint passes
- [ ] Quick manual smoke test

---

## When to Abort

Sometimes it's better to stop and reset:

| Situation | Action |
|-----------|--------|
| Requirements fundamentally wrong | Stop, clarify with user |
| Task scope grew 3x+ | Stop, split into subtasks |
| Blocked by external dependency | Stop, create blocker task |
| Repeated failures, no progress | Stop, reassess approach |

**How to abort cleanly**:
```bash
# Save work
git add -A
git commit -m "WIP: T{id} - pausing for reassessment"

# Update task status
# Edit task file: Status: BLOCKED

# Document why
# Add to progress log: Reason for pause, what's needed
```
