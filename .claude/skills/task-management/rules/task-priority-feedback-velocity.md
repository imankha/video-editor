# task-priority-feedback-velocity

**Priority:** HIGH
**Category:** Prioritization

## Rule

Prioritize tasks using **feedback velocity**: the user needs to interact with the software to discover what to do next. Schedule tasks that maximize learning per unit effort.

## The Formula

```
Priority = (User Impact × Simplicity) / Risk
```

| Factor | 1 (Low) | 3 (Medium) | 5 (High) |
|--------|---------|------------|----------|
| **User Impact** | Nice to have | Improves workflow | Unblocks user |
| **Simplicity** | Multi-week, many files | Few days, several files | Hours, 1-2 files |
| **Risk** | Could break core flows | Isolated risk | No risk |

## Quick Decision Tree

```
Is it simple AND high impact?
  → HIGH priority (do now)

Is it complex BUT high impact?
  → MEDIUM priority (plan carefully)

Is it simple BUT low impact?
  → LOW priority (do when convenient)

Is it complex AND low impact?
  → BACKLOG (maybe never)
```

## Infrastructure Exception

When making an infrastructure move (Modal, auth, deployment, etc.):

1. **Bundle ALL related tasks** - don't context-switch
2. **Complete the infrastructure** before returning to feedback velocity
3. **Mark as infrastructure phase** in PLAN.md

```markdown
## Current Focus
Infrastructure: Modal GPU Integration (bundle until stable)

## Infrastructure: Modal Integration
| ID | Task | Status |
|----|------|--------|
| T20 | Modal setup | DONE |
| T21 | GPU functions | IN_PROGRESS |
| T22 | Progress callbacks | TODO |  ← Do this before T30

## Active Tasks (after Modal complete)
| ID | Task | Status |
|----|------|--------|
| T30 | Progress bar UX | TODO |  ← Wait for Modal
```

## Correct Example

```markdown
# User has these tasks:
# - T30: Fix progress bar reset bug (Simple, High Impact)
# - T40: Add analytics dashboard (Complex, Medium Impact)
# - T50: Refactor export architecture (Complex, High Impact)

# Correct priority:
1. T30 - Simple + High Impact = DO FIRST
2. T50 - Complex but High Impact = PLAN NEXT
3. T40 - Complex + Medium Impact = BACKLOG
```

## Incorrect Example

```markdown
# BAD: Doing complex low-impact work first
"Let's refactor the entire export system before fixing the progress bar"
# Wrong: User can't use the app well while waiting for refactor

# BAD: Context-switching during infrastructure
"Modal is half-done, but let's fix this UI bug first"
# Wrong: Leaves infrastructure in broken state, harder to debug
```
