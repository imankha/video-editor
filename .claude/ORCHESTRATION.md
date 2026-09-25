# Orchestration Guide

The main conversation AI (Claude) orchestrates the workflow by spawning specialized agents and managing handoffs.

**Tier gate (read first):** the full pipeline below is the **L-tier** path. S-tier tasks spawn no implementation agents; every automatic landing still requires a separate Proof Verifier; M-tier defaults to direct implementation and one fresh-context Reviewer, with a Tester or expert only when classification justifies it. See CLAUDE.md § Task Tiers.

**Registered agents:** every file in `.claude/agents/` has frontmatter (name, description, tool scoping), so they are real subagents — spawn them with their own `subagent_type` (e.g. `code-expert`, `reviewer`) instead of pasting instructions into `general-purpose`. Reviewers have no Edit/Write tools but retain Bash for verification; source-read-only behavior is an instruction, not an enforced filesystem boundary.

All agents first read [Shared Agent Contract](references/agent-contract.md). CLAUDE.md owns policy; role files define the assigned work.

**Context loading:** before spawning anything, check `.claude/knowledge/` for the task's domain doc(s) and pass the doc path(s) in the spawn prompt. Agents read the knowledge doc first and only explore what it doesn't cover.

---

## Independent proof gate

After final implementation/review fixes, dispatch `subagent_type: proof-verifier` in a fresh context with acceptance criteria, base/head SHAs, test hashes, exact commands, and raw red/green evidence paths. It must not be the implementation/test author. Return missing evidence to its author and repeat; only the supervisor applies CLAUDE.md Landing Policy. A code-review APPROVED verdict is not a proof-verification verdict.

## Orchestrator Responsibilities

| Responsibility | How |
|----------------|-----|
| **Stage Detection** | Interpret user intent, determine current stage |
| **Agent Spawning** | Use Task tool to invoke appropriate agent |
| **Context Passing** | Include relevant handoff data in prompts |
| **Approval Gates** | Pause at Stage 2; pause at Stage 6 only when verification requires human judgment |
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
│  2. Code Expert if needed ──────────► Returns: entry points,    │
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
│  5.5 Migration (if schema changes detected)                 │
│     Spawn Migration agent ──────► writes migration file     │
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
│         │                         (bounded fix loop)         │
│         ▼                                                   │
│  ⏸️ CONDITIONAL GATE ◄──────────── Human-only verification  │
│         │                                                   │
│         ▼                                                   │
│  8. Finalize ───────────────────► Task complete             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent-Skill and Knowledge Matrix

Only resources that exist in this repository may be named in a handoff. The domain
knowledge documents are the expertise layer; skills are executable procedures.

| Agent | Required references | Load when |
|---|---|---|
| `code-expert` | `.claude/knowledge/README.md`, the matching domain document, `.claude/references/coding-standards.md` | Before exploring a material code/data-flow question |
| `architect` | Matching knowledge document, `.claude/references/coding-standards.md`, `.claude/references/design-patterns.md` | Every L-tier or explicitly design-gated task |
| `tester` | `.claude/skills/run-tests/SKILL.md`, `.claude/references/testing-matrix.md`, matching knowledge document | Test authorship or acceptance verification |
| `implementor` | Approved design, matching knowledge document, `.claude/references/coding-standards.md` | Implementing an approved specification |
| `reviewer` | `.claude/references/coding-standards.md`, `.claude/references/code-smells.md`, `.claude/references/design-patterns.md`, matching knowledge document | Every M/L review |
| `migration` | `.claude/knowledge/backend-services.md`, `.claude/knowledge/persistence-sync.md` | Schema or persisted-format changes |
| `proof-verifier` | `.claude/agents/proof-verifier.md`, evidence paths, test hashes, matching knowledge document | Before every automatic landing |
| `merge-reviewer` | `.claude/references/coding-standards.md`, `.claude/references/code-smells.md`, matching knowledge document | Branch readiness questions |
| `ui-designer` | `.claude/references/ui-style-guide.md`, matching screen knowledge document | UI decisions are underspecified |
| `ux-investigator` | `.claude/knowledge/README.md`, matching screen knowledge document, `drive-app-as-user` skill | Funnel or behavioral evidence is needed |

Use the executable `run-tests`, `dotask`, `spawn-worker`, `drive-app-as-user`,
`task-management`, and `visualize` skills only when their documented trigger applies.
Do not describe missing procedures as skills, and do not substitute a prose reference
for a knowledge document that an agent was required to read.

---

## Spawning Agents

### Code Expert
```
Agent tool:
  subagent_type: code-expert
  prompt: |
    Task T{id}: {title}

    Task: {description}

    Start from the knowledge doc(s): {.claude/knowledge/ paths for this domain}.
    Only explore what they don't cover. Find:
    1. Entry points (files/lines to modify)
    2. Data flow through the system
    3. Similar patterns in codebase
    4. Existing state to reuse
    5. Dependencies and risks

    Return structured findings per handoff schema, PLUS a "knowledge doc updates"
    section: lines to add/fix in the domain doc so this exploration is never repeated.
```

### Architect
```
Agent tool:
  subagent_type: architect
  prompt: |
    Task T{id}: {title}

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
Agent tool:
  subagent_type: tester
  prompt: |
    Phase 1 for task T{id}: {title}.

    Design doc: {path and approved revision}
    Acceptance criteria: {list}

    Create failing tests that will pass when feature is complete.
    Consult: testing-matrix.md for coverage guidance.
```

### Implementor
```
Agent tool:
  subagent_type: implementor
  prompt: |
    Task T{id}: {title}

    Approved design/specification: {path and revision}
    Failing tests: {test files}

    Write code that:
    1. Preserves approved behavior and contracts; flags substantive design errors
    2. Makes tests pass
    3. Follows the approved design, `.claude/references/coding-standards.md`, and the
       matching `.claude/knowledge/` domain document
    4. Has no state duplication

    Use `.claude/skills/run-tests/SKILL.md` for test scope and only the domain procedures
    named by the canonical `/dotask` expert-selection matrix.
```

### Reviewer (Phase 1: Solo Review)

**M-tier:** spawn ONE reviewer with the prompt below, scoped to correctness + requirements + persistence rules. Chasing every possible finding leads to over-engineering — the reviewer reports what would actually break or violate a hard rule.

**L-tier: parallel review fan-out.** Spawn 3-4 `reviewer` subagents CONCURRENTLY (one message, multiple Agent calls), each with the same diff but ONE lens:

| Lens | Focus |
|------|-------|
| Correctness | Logic bugs, edge cases, failure modes, requirement coverage |
| Persistence & state | Gesture-based persistence rules, state duplication, sync (coding-standards.md) |
| Performance | N+1 queries, re-render storms, R2 round-trips, large-payload handling |
| Security | Auth checks on new endpoints, injection, data exposure (only when endpoints/auth touched) |

Merge findings, dedupe, then run the normal conversation protocol on the union. Diverse lenses catch failure modes a single reviewer misses; parallelism can reduce latency, but token cost and shared quota still grow with each reviewer.

```
Agent tool:
  subagent_type: reviewer
  prompt: |
    Task T{id}: {title}. Review lens: {lens (L-tier) or "full" (M-tier)}.

    ## Your Education -- Read These Files First
    Before reviewing ANY code, read and internalize:
    1. .claude/references/coding-standards.md (ALL rules)
    2. .claude/references/code-smells.md (smell catalog)
    3. .claude/references/design-patterns.md (expected patterns)
    4. .claude/agents/reviewer.md (your full instructions + severity levels)

    ## Approved Design
    {task path and approved design path when the tier requires one}

    ## Implementation Changes
    {base/head SHAs, diff path, changed-file paths, test-evidence paths}

    ## Instructions
    1. Read all reference files listed above
    2. Read task acceptance criteria and the approved design when required
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
  subagent_type: reviewer
  prompt: |
    You are continuing your review of T{id}.

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
Agent tool:
  subagent_type: tester
  prompt: |
    Phase 2 for task T{id}: {title}.

    Tests to run: {test files from Phase 1}

    Run tests and report:
    1. Pass/fail counts
    2. Failure details with suggested fixes
    3. Coverage assessment

    Return evidence to the orchestrator; escalate after one failed focused correction instead of looping indefinitely.
```

### Migration
```
Agent tool:
  subagent_type: migration
  prompt: |
    Task T{id}: {title}

    ## Schema Changes (from Implementor)
    {git diff of schema changes}

    ## Current Migration State
    {ls of src/backend/app/migrations/{track}/ showing latest version}

    Create the next versioned migration file.
```

### Merge Reviewer
```
Agent tool:
  subagent_type: merge-reviewer
  prompt: |
    Branch: {current branch}
    Main branch: master

    Run git diff master...HEAD and audit every change against the checklist.
    Return ALL CLEAR or ISSUES FOUND with specific file:line references.
```

---

## Implementation Fan-Out

For L-tier tasks with 4+ independently editable files, use scoped fan-out when it reduces work. M-tier stays direct by default; file count alone does not authorize extra agents. See [4-implementation.md](workflows/4-implementation.md#subagent-delegation-context-efficiency) for the full protocol.

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

1. **Do not act on unsupported output** - retain it as failure evidence and identify the missing fact
2. **Provide targeted context** - correct the specific missing information before one retry
3. **Simplify the ask** - break into smaller steps
4. **Escalate if stuck** - use the expert after one failed focused fix; consult error-recovery.md

---

## Approval Gate Protocol

At Stage 2 (Architecture), and at Stage 6 only when the result cannot be proven automatically:

1. **Present clearly** - summarize what needs review
2. **Wait for response** - don't proceed without approval
3. **Handle feedback** - revise if needed, re-present
4. **Document approval** - note in task file progress log
