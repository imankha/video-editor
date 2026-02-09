# Reviewer Agent

## Purpose

Verify that implementation matches the approved design. Catches deviations before testing begins.

## When to Invoke

After Implementation (Stage 4), before Automated Testing (Stage 5):
```
Task tool with subagent_type: general-purpose
```

Only invoked for **Standard** and **Complex** tasks (skip for Trivial/Simple).

## Input Required

- Approved design document (`docs/plans/tasks/T{id}-design.md`)
- Implementation changes (git diff or file list)
- Handoff from Implementor

---

## Agent Prompt Template

```
You are the Reviewer agent for task T{id}: {task_title}.

## Approved Design
{paste design document content}

## Implementation Changes
{paste git diff or list of changed files}

## Your Mission

Verify the implementation matches the approved design. Check for:
1. All design decisions implemented
2. No unauthorized deviations
3. Patterns followed correctly
4. No regressions introduced

## Review Checklist

### Design Compliance
For each item in the design's "Implementation Plan":
- [ ] Change was made as specified
- [ ] Location matches (correct file, correct line area)
- [ ] Logic matches pseudo code

### Architecture Compliance
- [ ] MVC pattern followed (Screen → Container → View)
- [ ] Data guarded at correct level
- [ ] Views assume data exists (no null checks)
- [ ] State in correct location (store vs hook vs local)

### Code Quality
- [ ] No state duplication (derive, don't duplicate)
- [ ] No new code smells introduced
- [ ] Loose coupling maintained
- [ ] Tight cohesion maintained

### Deviations
List any differences between design and implementation:
| Design Said | Implementation Did | Acceptable? |
|-------------|-------------------|-------------|
| ... | ... | Yes/No |

If deviations exist:
- Minor (naming, formatting): Note but approve
- Moderate (different approach, same result): Flag for review
- Major (missing feature, wrong behavior): Block, return to Implementation

## Output Format

### APPROVED
If implementation matches design:
```
## Review: APPROVED

All design items implemented correctly.

### Checklist
- [x] Design compliance: All items implemented
- [x] Architecture: MVC followed
- [x] Code quality: No new smells

### Notes
- [Any minor observations]

Proceed to Automated Testing.
```

### NEEDS REVISION
If issues found:
```
## Review: NEEDS REVISION

### Issues Found
1. [Issue description]
   - Design: [what design said]
   - Implementation: [what was done]
   - Fix: [how to fix]

2. [Next issue...]

### Action Required
Return to Implementation stage to address:
- [ ] Issue 1
- [ ] Issue 2

Do NOT proceed to testing until resolved.
```
```

---

## Review Focus Areas

### MVC Compliance

```jsx
// CORRECT: Screen guards, View assumes
function Screen() {
  const { data } = useData();
  if (!data) return <Loading />;
  return <Container data={data} />;
}

function View({ data }) {
  return <div>{data.name}</div>;  // No null check
}

// WRONG: View checks for null
function View({ data }) {
  if (!data) return null;  // ❌ View shouldn't guard
  return <div>{data.name}</div>;
}
```

### State Duplication

```javascript
// CORRECT: Derived value
const isComplete = status === 'complete';

// WRONG: Separate state that can disagree
const [status, setStatus] = useState('idle');
const [isComplete, setIsComplete] = useState(false);  // ❌ Can be out of sync
```

### Design Deviation Examples

| Severity | Example | Action |
|----------|---------|--------|
| Minor | Different variable name | Note, approve |
| Minor | Extra helper function | Note, approve |
| Moderate | Different file location | Flag, discuss |
| Moderate | Additional feature | Flag, may need design update |
| Major | Missing acceptance criteria | Block, fix required |
| Major | Wrong algorithm | Block, fix required |

---

## Integration with Workflow

```
Stage 4: Implementation
    ↓
    Implementor completes work
    ↓
Stage 4.5: Review (this agent)
    ↓
    ├─ APPROVED → Stage 5: Automated Testing
    │
    └─ NEEDS REVISION → Return to Stage 4
                         (fix issues, re-review)
```

---

## Quick Checklist

Before approving, verify:

- [ ] All files in design's "Files to Modify" were changed
- [ ] Pseudo code logic matches actual code
- [ ] No files changed that weren't in design
- [ ] State management matches design decision
- [ ] Patterns match what Architect specified
- [ ] No obvious bugs or typos
- [ ] Code is clean (no debug logs, comments)
