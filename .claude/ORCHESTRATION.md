# Orchestration Guide

The main conversation AI (Claude) orchestrates the workflow by spawning specialized agents and managing handoffs.

---

## Orchestrator Responsibilities

| Responsibility | How |
|----------------|-----|
| **Stage Detection** | Interpret user intent, determine current stage |
| **Agent Spawning** | Use Task tool to invoke appropriate agent |
| **Context Passing** | Include relevant handoff data in prompts |
| **Approval Gates** | Pause and wait for user at Stage 2 and Stage 6 |
| **Error Handling** | Detect failures, apply recovery procedures |
| **Progress Tracking** | Update task files and todo list |

---

## Workflow Flow

```
User: "Implement T{id}"
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (Main AI)                                     │
│                                                             │
│  1. Classify task complexity                                │
│         │                                                   │
│         ▼                                                   │
│  2. Spawn Code Expert ──────────► Returns: entry points,    │
│         │                         data flow, patterns       │
│         ▼                                                   │
│  3. Spawn Architect ────────────► Returns: design doc       │
│         │                                                   │
│         ▼                                                   │
│  ⏸️ APPROVAL GATE ◄─────────────── User reviews design      │
│         │                                                   │
│         ▼                                                   │
│  4. Spawn Tester (Phase 1) ─────► Returns: failing tests    │
│         │                                                   │
│         ▼                                                   │
│  5. Implementation (dependency-aware fan-out)               │
│     5a. Build foundation files (sequential)                 │
│     5b. Fan-out consumer updates (parallel subagents)       │
│     5c. Cleanup + test updates                              │
│         │                                                   │
│         ▼                                                   │
│  6. Spawn Reviewer (Phase 1) ───► Returns: approval/issues  │
│     6a. If NEEDS CONVERSATION:                              │
│         Implementor responds to MAJOR findings              │
│         Spawn Reviewer (Phase 2) to evaluate pushback       │
│         Resolve or escalate to user                         │
│         │                                                   │
│         ▼                                                   │
│  7. Spawn Tester (Phase 2) ─────► Returns: test results     │
│         │                         (loop until pass)         │
│         ▼                                                   │
│  ⏸️ APPROVAL GATE ◄─────────────── User tests manually      │
│         │                                                   │
│         ▼                                                   │
│  8. Finalize ───────────────────► Task complete             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent-Skill Matrix

Which skills are relevant to each agent:

### Code Expert
| Skill | Relevance | Load When |
|-------|-----------|-----------|
| task-management | HIGH | Understanding task context |
| mvc-pattern | MEDIUM | Mapping component structure |
| state-management | MEDIUM | Finding state locations |
| database-schema | MEDIUM | If backend changes needed |

### Architect
| Skill | Relevance | Load When |
|-------|-----------|-----------|
| mvc-pattern | CRITICAL | Designing component structure |
| state-management | CRITICAL | Deciding state locations |
| data-always-ready | CRITICAL | Ensuring proper data flow |
| type-safety | HIGH | Designing interfaces |
| gesture-based-sync | HIGH | If API changes needed |
| persistence-model | MEDIUM | If storage changes needed |

**References**:
- code-smells.md - Always consult
- design-patterns.md - Always consult

### Tester
| Skill | Relevance | Load When |
|-------|-----------|-----------|
| lint | HIGH | Running build checks |
| bug-reproduction | HIGH | Diagnosing test failures |

**References**:
- testing-matrix.md - Always consult

### Implementor
| Skill | Relevance | Load When |
|-------|-----------|-----------|
| data-always-ready | CRITICAL | Writing components |
| mvc-pattern | CRITICAL | Component structure |
| state-management | CRITICAL | Managing state |
| type-safety | HIGH | Writing type-safe code |
| keyframe-data-model | HIGH | If keyframes involved |
| ui-style-guide | MEDIUM | If UI changes |
| api-guidelines | HIGH | If backend changes |
| lint | HIGH | Validating code |

### Reviewer
| Skill | Relevance | Load When |
|-------|-----------|-----------|
| mvc-pattern | CRITICAL | Verifying structure |
| data-always-ready | CRITICAL | Checking data guards |
| state-management | CRITICAL | Verifying state approach |
| gesture-based-sync | CRITICAL | Checking persistence rules |
| type-safety | HIGH | Verifying type safety |

**References** (reviewer MUST read before reviewing):
- coding-standards.md - All implementation rules (CRITICAL)
- code-smells.md - Fowler's refactoring catalog (CRITICAL)
- design-patterns.md - Expected patterns (HIGH)

### Merge Reviewer
| Skill | Relevance | Load When |
|-------|-----------|-----------|
| state-management | CRITICAL | Checking sync strategy, store ownership |
| mvc-pattern | HIGH | Verifying architecture compliance |
| data-always-ready | HIGH | Checking data guards |
| keyframe-data-model | MEDIUM | If keyframe code changed |

**References**:
- coding-standards.md - Always consult (persistence rules)
- code-smells.md - Always consult

---

## Spawning Agents

### Code Expert
```
Task tool:
  subagent_type: Explore
  prompt: |
    You are the Code Expert agent for task T{id}: {title}.

    Task: {description}

    Find:
    1. Entry points (files/lines to modify)
    2. Data flow through the system
    3. Similar patterns in codebase
    4. Existing state to reuse
    5. Dependencies and risks

    Return structured findings per handoff schema.
```

### Architect
```
Task tool:
  subagent_type: Plan
  prompt: |
    You are the Architect agent for task T{id}: {title}.

    Task: {description}
    Code Expert findings: {handoff from Code Expert}

    Create design doc at docs/plans/tasks/T{id}-design.md with:
    1. Current state (diagrams, pseudo code)
    2. Target state (diagrams, pseudo code)
    3. Implementation plan (files, changes)
    4. Risks and open questions

    Focus on: DRY, loose coupling, tight cohesion, MVC compliance.
    Consult: code-smells.md, design-patterns.md
```

### Tester (Phase 1)
```
Task tool:
  subagent_type: general-purpose
  prompt: |
    You are the Tester agent (Phase 1) for task T{id}: {title}.

    Design doc: {content}
    Acceptance criteria: {list}

    Create failing tests that will pass when feature is complete.
    Consult: testing-matrix.md for coverage guidance.
```

### Implementor
```
Task tool:
  subagent_type: general-purpose
  prompt: |
    You are the Implementor agent for task T{id}: {title}.

    Approved design: {design doc content}
    Failing tests: {test files}

    Write code that:
    1. Follows design exactly
    2. Makes tests pass
    3. Follows MVC + Data Always Ready
    4. Has no state duplication

    Use skills: data-always-ready, mvc-pattern, state-management, type-safety
```

### Reviewer (Phase 1: Solo Review)
```
Agent tool:
  subagent_type: general-purpose
  prompt: |
    You are the Reviewer agent for task T{id}: {title}.

    ## Your Education -- Read These Files First
    Before reviewing ANY code, read and internalize:
    1. .claude/references/coding-standards.md (ALL rules)
    2. .claude/references/code-smells.md (smell catalog)
    3. .claude/references/design-patterns.md (expected patterns)
    4. .claude/agents/reviewer.md (your full instructions + severity levels)

    ## Approved Design
    {design doc path or content}

    ## Implementation Changes
    {git diff or changed file list with paths}

    ## Instructions
    1. Read all reference files listed above
    2. Read the approved design document
    3. Read every changed file IN FULL (not just the diff)
    4. Produce findings using the format in reviewer.md
    5. Categorize each finding as BLOCKING, MAJOR, or MINOR
    6. Return verdict: APPROVED, NEEDS REVISION, or NEEDS CONVERSATION
```

### Reviewer (Phase 2: Evaluate Pushback)

Only spawned when Phase 1 returned NEEDS CONVERSATION and the implementor
has responded to each MAJOR finding. See `.claude/agents/reviewer.md` for
the Conversation Round Template.

```
Agent tool:
  subagent_type: general-purpose
  prompt: |
    You are the Reviewer agent, continuing your review of T{id}.

    Read .claude/agents/reviewer.md for your full instructions,
    especially the "Conversation Round Template" section.

    ## Your Prior Findings (Phase 1)
    {paste MAJOR findings from Phase 1}

    ## Implementor's Responses
    {for each MAJOR finding: ACCEPT / PUSHBACK (with justification) / PARTIAL}

    ## Instructions
    1. Re-read .claude/references/coding-standards.md
    2. For each pushback, evaluate on technical merit
    3. Decide: ACCEPTED, SUSTAINED, or COMPROMISE
    4. Return final verdict: APPROVED, NEEDS REVISION, or ESCALATE TO USER
```

### Review Conversation Flow (Orchestrator Steps)

```
1. Spawn Reviewer Phase 1
   |
   +-- APPROVED --> proceed to Stage 5
   |
   +-- NEEDS REVISION (BLOCKING) --> send fixes back to implementor,
   |                                  then re-run Phase 1
   |
   +-- NEEDS CONVERSATION (MAJOR, no BLOCKING) -->
       |
       2. Present MAJOR findings to implementor (or spawn implementor
          subagent to respond to each finding)
       |
       3. Collect implementor responses (ACCEPT / PUSHBACK / PARTIAL)
       |
       4. Spawn Reviewer Phase 2 with findings + responses
       |
       +-- APPROVED --> proceed to Stage 5
       |
       +-- NEEDS REVISION --> implementor fixes sustained issues,
       |                       then re-run Phase 1
       |
       +-- ESCALATE --> present disagreement to user for decision
```

**Key rules:**
- Maximum 2 conversation rounds. If still unresolved after round 2, escalate.
- BLOCKING issues skip conversation -- they go straight to NEEDS REVISION.
- The orchestrator does NOT inject its own opinion during the conversation.
  It relays findings and responses faithfully between reviewer and implementor.

### Tester (Phase 2)
```
Task tool:
  subagent_type: general-purpose
  prompt: |
    You are the Tester agent (Phase 2) for task T{id}: {title}.

    Tests to run: {test files from Phase 1}

    Run tests and report:
    1. Pass/fail counts
    2. Failure details with suggested fixes
    3. Coverage assessment

    Loop with Implementor until all tests pass.
```

### Merge Reviewer
```
Task tool:
  subagent_type: general-purpose
  prompt: |
    You are the Merge Reviewer agent.
    Read .claude/agents/merge-reviewer.md for your full instructions.

    Branch: {current branch}
    Main branch: master

    Run git diff master...HEAD and audit every change against the checklist.
    Return ALL CLEAR or ISSUES FOUND with specific file:line references.
```

---

## Implementation Fan-Out

For tasks with 4+ files, the orchestrator delegates file edits to parallel subagents instead of editing everything in main context. See [4-implementation.md](workflows/4-implementation.md#subagent-delegation-context-efficiency) for the full protocol.

**Quick reference:**

```
1. Categorize files: Foundation → Consumer → Cleanup → Tests
2. Build foundation files first (main context or 1 subagent)
3. Extract API contracts (exports, function signatures)
4. Spawn 2-4 parallel consumer subagents (use implementor.md template)
5. Handle cleanup in main context (deletions, index updates)
6. Spawn 1 test update subagent if needed
7. Run tests + build in main context
```

**Subagent prompt:** Use the "File-Scoped Subagent" template from `.claude/agents/implementor.md`.

**Key rule:** Each subagent receives API contracts (function signatures), NOT full foundation file source. This keeps subagent context focused.

---

## Handoff Protocol

When passing context between agents:

1. **Use structured handoff** from `.claude/schemas/handoffs.md`
2. **Include relevant artifacts** (design doc, test files, diffs)
3. **Summarize key decisions** made by previous agent
4. **Flag any concerns** or deviations

---

## Error Handling

When an agent fails or returns poor output:

1. **Don't use bad output** - discard and retry
2. **Provide more context** - add missing information
3. **Simplify the ask** - break into smaller steps
4. **Escalate if stuck** - consult error-recovery.md

---

## Approval Gate Protocol

At Stage 2 (Architecture) and Stage 6 (Manual Testing):

1. **Present clearly** - summarize what needs review
2. **Wait for response** - don't proceed without approval
3. **Handle feedback** - revise if needed, re-present
4. **Document approval** - note in task file progress log
