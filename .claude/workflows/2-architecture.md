# Stage 2: Architecture

## Purpose

Create a design document that describes the changes at a high level using diagrams and pseudo code. **User must approve before implementation begins.**

## Checklist

### 1. Run Architect Agent

**Spawn the Architect agent** to create the design document:

```
Use Task tool with subagent_type: Plan

Prompt: See .claude/agents/architect.md for full template

Include:
- Task ID and title
- Acceptance criteria
- Code Expert findings (entry points, data flow, similar patterns)
- Request: Create design doc with current state, target state, implementation plan
```

### 2. Write Design Document

Save the Architect's output to: `docs/plans/tasks/T{id}-design.md`

The document should contain:

| Section | Content |
|---------|---------|
| **Current State** | Mermaid diagram + pseudo code of how it works now |
| **Target State** | Mermaid diagram + pseudo code of the goal |
| **Implementation Plan** | Files to change, pseudo code changes |
| **Risk Assessment** | What could go wrong, mitigations |
| **Open Questions** | Decisions needing user input |

### 3. Present for Approval

Tell the user:

```
Design document ready for review: `docs/plans/tasks/T{id}-design.md`

**Summary:**
- [1-2 sentence overview of the approach]
- [Key design decision]

**Open questions:**
- [Any questions from the doc]

Please review and let me know:
- "Approved" to proceed
- Or feedback/changes needed
```

### 4. Handle Feedback

| User Says | Action |
|-----------|--------|
| "Approved" / "Looks good" | Proceed to Stage 3 (Test First) |
| "Change X to Y" | Revise design doc, re-present |
| "Why did you...?" | Explain, may revise doc |
| "What about...?" | Address concern, may revise doc |

### 5. Commit Design Doc

Once approved:

```bash
git add docs/plans/tasks/T{id}-design.md
git commit -m "docs: Add approved design for T{id}

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Design Document Template

```markdown
# T{id} Design: {Task Title}

**Status:** DRAFT / APPROVED
**Author:** Architect Agent
**Approved:** {date} (after user approval)

## Current State ("As Is")

### Data Flow
\`\`\`mermaid
flowchart LR
    A[Component] --> B[Handler]
    B --> C[Store]
\`\`\`

### Current Behavior
\`\`\`pseudo
when X happens:
    do Y
    then Z
\`\`\`

### Limitations
- [What's wrong]

## Target State ("Should Be")

### Updated Flow
\`\`\`mermaid
flowchart LR
    A[Component] --> B[New Handler]
    B --> C[Store]
\`\`\`

### Target Behavior
\`\`\`pseudo
when X happens:
    do NEW_Y
    then Z
\`\`\`

## Implementation Plan ("Will Be")

### Files to Modify
| File | Change |
|------|--------|
| `path/file.jsx` | Add handler |

### Pseudo Code Changes
\`\`\`pseudo
// In file.jsx
- old code
+ new code
\`\`\`

## Risks
| Risk | Mitigation |
|------|------------|
| Risk 1 | How to handle |

## Open Questions
- [ ] Question 1
```

---

## After Approval

Proceed to [3-test-first.md](3-test-first.md) to create failing tests.
