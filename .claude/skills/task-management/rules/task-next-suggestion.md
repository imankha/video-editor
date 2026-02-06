# task-next-suggestion

**Priority:** HIGH
**Category:** Prioritization

## Rule

When user asks "what's next?" or similar, analyze PLAN.md and provide:
1. **Recommended task** with reasoning
2. **2-3 alternatives** with pros/cons
3. **Context** about current phase (infrastructure vs feedback velocity)

## Response Format

```markdown
## Recommended: T{ID} - {Title}

**Why**: {1-2 sentence reasoning based on feedback velocity}

### Alternatives

| Task | Pros | Cons |
|------|------|------|
| T{ID} - {Name} | {benefits} | {drawbacks} |
| T{ID} - {Name} | {benefits} | {drawbacks} |

### Current Phase
{Infrastructure move in progress? Feedback velocity phase?}
```

## Decision Factors

When choosing next task, weigh these factors:

| Factor | Weight | Question |
|--------|--------|----------|
| **User Impact** | HIGH | Will user notice/benefit immediately? |
| **Simplicity** | HIGH | Can it be done in one session? |
| **Unblocks Other Work** | MEDIUM | Does this enable future tasks? |
| **Risk** | MEDIUM | Could this break existing functionality? |
| **Infrastructure Phase** | CONTEXT | Are we mid-infrastructure move? |

### Infrastructure Phase Rules

If an infrastructure epic is IN_PROGRESS:
- **Recommend completing it** before switching
- **Exception**: Urgent bugs that block users

If no infrastructure in progress:
- **Prioritize feedback velocity** (simple + high impact)
- Infrastructure moves only when explicitly needed

## Example Response

```markdown
## Recommended: T10 - Progress Bar Improvements

**Why**: Simple fix (frontend-only), high user impact (progress resets are confusing),
low risk (isolated to export UI). Can be completed in one session.

### Alternatives

| Task | Pros | Cons |
|------|------|------|
| T20 - E2E Test Reliability | Improves CI reliability | Lower user impact, more complex |
| T30 - Fly.io Deployment | Moves toward production | Infrastructure move, needs focus |

### Current Phase
**Feedback Velocity** - No infrastructure epics in progress. Prioritizing
simple, high-impact tasks that let you use the app and discover what's next.
```

## Bad Example

```markdown
# BAD: No reasoning, no alternatives
"Next task is T10."

# BAD: Too many options without clear recommendation
"You could do T10, T20, T30, T40, T50, T60..."

# BAD: Ignoring infrastructure phase
"Let's do T10 (UI fix)" when deployment epic is half-done
```

## When User Disagrees

If user chooses a different task:
1. **Accept their choice** - they have context you don't
2. **Update PLAN.md** if priority changed
3. **Note the reason** if they share it (helps future suggestions)
