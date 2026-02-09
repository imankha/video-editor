# Task Retrospectives

Learning from completed tasks to improve future work.

## Purpose

After each task, capture:
- What worked well
- What didn't work
- Lessons for future tasks

This creates institutional memory that prevents repeating mistakes.

---

## When to Write

Create a retrospective after **Standard** and **Complex** tasks complete (Stage 7).

Skip for **Trivial** and **Simple** tasks unless something notable happened.

---

## File Naming

```
.claude/retrospectives/T{id}-{short-name}.md
```

Example: `T06-tracking-toggle.md`

---

## Template

```markdown
# Retrospective: T{id} - {Task Title}

**Date**: {completion date}
**Complexity**: {Trivial|Simple|Standard|Complex}
**Duration**: {time from start to merge}

## Summary

{1-2 sentence description of what was done}

## What Worked Well

- {Thing that went smoothly}
- {Good decision that paid off}
- {Pattern that should be repeated}

## What Didn't Work

- {Issue encountered}
- {Time wasted on X}
- {Approach that had to be changed}

## Lessons Learned

### For Code Expert
- {Insight about codebase exploration}

### For Architect
- {Insight about design decisions}

### For Implementor
- {Insight about implementation}

### For Tester
- {Insight about testing}

## Recommendations

- [ ] {Action item for future tasks}
- [ ] {Process improvement suggestion}
- [ ] {Documentation to add/update}

## Related

- Design doc: `docs/plans/tasks/T{id}-design.md`
- Task file: `docs/plans/tasks/T{id}-*.md`
```

---

## Example Retrospective

```markdown
# Retrospective: T06 - Move Tracking Toggle to Layer Icon

**Date**: 2026-02-09
**Complexity**: Simple
**Duration**: 1 session

## Summary

Moved the player boxes toggle from a separate button to the layer icon in the timeline, with visual slash indicator when OFF.

## What Worked Well

- Reusing existing `showPlayerBoxes` state avoided duplication
- Following similar pattern from FramingMode made implementation straightforward
- Small, focused scope kept changes minimal

## What Didn't Work

- Initially added unnecessary implementation comments that had to be removed
- Forgot to remove unused Eye/EyeOff imports on first pass

## Lessons Learned

### For Code Expert
- Always check for existing state before assuming new state is needed

### For Architect
- When moving UI, look for similar moves in codebase first

### For Implementor
- Don't add implementation comments - code should be self-documenting
- Check imports after removing code

### For Tester
- N/A - no automated tests added (Simple task)

## Recommendations

- [ ] Add to Implementor checklist: "Remove unused imports after refactoring"
- [ ] Add to task-complete checklist: "Verify no implementation comments"

## Related

- Task file: `docs/plans/tasks/T06-remove-player-tracking-button.md`
```

---

## Using Retrospectives

### During Task Start (Stage 1)

Code Expert should check for relevant retrospectives:
```
Search .claude/retrospectives/ for:
- Tasks in same feature area
- Tasks with similar patterns
- Recent tasks for process improvements
```

### Quarterly Review

Periodically review retrospectives to:
- Identify recurring issues
- Update agent instructions
- Improve workflow documentation
