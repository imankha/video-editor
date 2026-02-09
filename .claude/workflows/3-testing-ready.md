# Stage 3: Testing Ready

## Checklist Before Handoff

### 1. Pre-Testing Cleanup

**Remove temporary code:**
- [ ] No `console.log` statements (frontend)
- [ ] No debug `print()` statements (backend)
- [ ] No commented-out code blocks
- [ ] No TODO comments for this task (complete them or create new tasks)

### 2. Update Task Status

Edit `docs/plans/tasks/T{id}-*.md`:
```markdown
**Status:** TESTING
**Updated:** {today's date}
```

Update Progress Log:
```markdown
**{date}**: Implementation complete. Ready for testing.
- Changed: [list of files modified]
- Added: [new functionality]
- Removed: [deprecated code]
```

### 3. Provide Testing Instructions

Tell the user exactly how to test:

```markdown
## Manual Testing Instructions

**Setup:**
1. Start dev servers (if not running)
2. Navigate to [specific page/feature]

**Test Cases:**
1. [ ] [Action] → [Expected result]
2. [ ] [Action] → [Expected result]
3. [ ] [Edge case] → [Expected behavior]

**What to look for:**
- [Specific UI changes]
- [Behavior changes]
- [Any regressions to watch for]
```

### 4. Commit All Changes

Ensure all work is committed:
```bash
git status  # Should show clean working tree or only test files
git log --oneline -3  # Verify recent commits
```

---

## Example Handoff Message

```
Implementation complete for T{id}.

**Changes:**
- Modified `ComponentX.jsx` to add toggle behavior
- Removed old button from `ViewY.jsx`

**To test:**
1. Go to Overlay mode with a video that has player detections
2. Click the Crosshair layer icon in the timeline
3. Verify player boxes toggle on/off
4. Verify icon shows slash when OFF

Ready for your testing. Let me know if approved or if changes needed.
```

---

## After User Approves

Proceed to [4-task-complete.md](4-task-complete.md) to finalize.
