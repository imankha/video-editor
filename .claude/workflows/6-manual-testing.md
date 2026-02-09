# Stage 6: Manual Testing

## Purpose

Provide the user with clear instructions for manual testing. Automated tests passed; now verify the feature works correctly in real usage.

## Checklist

### 1. Pre-Testing Cleanup

**Remove temporary code before user sees it:**
- [ ] No `console.log` statements (frontend)
- [ ] No debug `print()` statements (backend)
- [ ] No commented-out code blocks
- [ ] No TODO comments for this task

### 2. Update Task Status

Edit `docs/plans/tasks/T{id}-*.md`:
```markdown
**Status:** TESTING
**Updated:** {today's date}
```

### 3. Provide Testing Instructions

**Tell the user exactly how to test.** Use this template:

```markdown
## Ready for Manual Testing

**Automated tests:** All passing (X unit, Y E2E, Z backend)

### Setup
1. Start dev servers (if not running):
   - Frontend: `cd src/frontend && npm run dev`
   - Backend: `cd src/backend && uvicorn app.main:app --reload`
2. Navigate to [specific URL/page]

### Test Cases

**Test 1: [Primary functionality]**
1. [Step 1]
2. [Step 2]
3. Expected: [what should happen]

**Test 2: [Secondary functionality]**
1. [Step 1]
2. [Step 2]
3. Expected: [what should happen]

**Test 3: [Edge case]**
1. [Step 1]
2. Expected: [what should happen]

### What to Look For
- [Specific UI changes]
- [Behavior changes]
- [Any regressions to watch for]

### Known Limitations
- [Any limitations to be aware of]
```

### 4. Commit All Changes

```bash
git status  # Should be clean or only docs
git add -A && git commit -m "docs: Update T{id} status to TESTING"
```

---

## Example Handoff Message

```
Ready for manual testing on T{id}.

**Automated tests:** All passing

**To test:**
1. Go to Overlay mode with a video that has player detections
2. Look at the timeline - find the Crosshair layer icon
3. Click it - player boxes should toggle off (icon shows slash)
4. Click again - boxes should toggle on (slash disappears)

Let me know if approved or if changes are needed!
```

---

## After User Approves

When user says "approved", "that worked", "looks good", or "merge it":

Proceed to [7-task-complete.md](7-task-complete.md) to finalize.
