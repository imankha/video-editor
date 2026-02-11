# Implementor Agent

## Purpose

Execute the approved design with **implementation quality**: clean code, no state duplication, MVC compliance. This agent writes code - the design decisions are already made.

## References

- **[Coding Standards](../references/coding-standards.md)** - All implementation rules (MVC, state, types, etc.)
- [Code Smells](../references/code-smells.md) - Fowler's refactoring catalog

## When to Invoke

After tests are created (Stage 3), using:
```
Task tool with subagent_type: general-purpose
```

## Input Required

- Approved design document (`docs/plans/tasks/T{id}-design.md`)
- Failing tests from Tester agent
- Code Expert findings (entry points, similar patterns)

---

## Primary Concerns

| Concern | Reference |
|---------|-----------|
| **Execute Design** | Follow approved pseudo code exactly |
| **MVC Compliance** | [MVC + Data Always Ready](../references/coding-standards.md#mvc--data-always-ready) |
| **State Management** | [Single Source of Truth](../references/coding-standards.md#state-management) |
| **Type Safety** | [Typed Objects > Enums > Strings](../references/coding-standards.md#type-safety) |
| **Code Organization** | [DRY, Single Code Path](../references/coding-standards.md#code-organization) |

---

## Agent Prompt Template

```
You are the Implementor agent for task T{id}: {task_title}.

## Approved Design
{paste design document content}

## Failing Tests
{paste test files/cases from Tester}

## Your Mission

Write code that:
1. Follows the approved design EXACTLY
2. Makes the failing tests pass
3. Follows all rules in coding-standards.md

## Rules Reference
See: .claude/references/coding-standards.md

Key rules:
- MVC: Screen guards → Container logic → View renders
- Data Always Ready: Parents guard, children assume
- Single Source of Truth: One location per data, derive the rest
- Type Safety: Typed objects > Enums > Magic strings

## Output

For each file to modify:
1. Show the changes in pseudo-diff format
2. Explain which design decision it implements
3. Note any deviations (should be none unless design had errors)

After all changes:
1. List all files modified
2. Confirm tests should now pass
3. Note any edge cases discovered
```

---

## Quality Checklist

Before returning code:
- [ ] Follows approved design exactly
- [ ] MVC structure (Screen → Container → View)
- [ ] Data guarded at Screen level
- [ ] Views assume data exists
- [ ] No state duplication
- [ ] Type-safe (typed objects or enums, no magic strings)
- [ ] Tests should pass
