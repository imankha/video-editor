# Stage 1: Task Start

## Checklist

### 1. Create Feature Branch
```bash
git checkout -b feature/T{id}-{short-description}
```

### 1b. Mark Task WIP

Set the task's Status column to `WIP` in `docs/plans/PLAN.md` (factual status — AI owns this; see CLAUDE.md Task Status Rule). Also update the task file's Status field; container workers delegate both updates to the supervisor. Do NOT touch DONE — that is a user promotion.

`WIP` means AI is actively working. The moment the task is blocked on the user (design gate, question, human-only manual test, or branch awaiting the user's merge verdict), switch it to `WAITING ON USER`, and back to `WIP` when they unblock it.

Name the branch `feature/T{id}-{slug}` and start every commit subject with `T{id}:` — the task board derives the branch shown on hover from exactly those two things.

### 2. Read Task File
- Read `docs/plans/tasks/T{id}-*.md`
- Understand the problem, solution, and acceptance criteria
- Note any referenced files or screenshots

### 3. Run Code Expert Agent

**Load the knowledge docs first.** Spawn Code Expert only for material gaps identified by classification; otherwise use verified knowledge directly:

```
Use Agent tool with subagent_type: code-expert

Prompt: See .claude/agents/code-expert.md for full template

Key points to include:
- Task ID and title
- Task description and acceptance criteria
- Request: entry points, data flow, similar patterns, dependencies
```

The Code Expert will return a report with:
- Entry points (files/lines to modify)
- Data flow through the system
- Similar patterns to follow
- Dependencies and side effects
- Implementation recommendations

### 4. Document Findings

Update the task file based on Code Expert report:

**Relevant Files section:**
```markdown
### Relevant Files
- `src/frontend/src/components/Foo.jsx:42` - Entry point, renders the feature
- `src/backend/app/routers/bar.py:100` - API endpoint
- `src/frontend/src/modes/Baz.jsx:200` - Similar pattern to follow
```

**Progress Log:**
```markdown
**{date}**: Started implementation.
- Entry points: [list from Code Expert]
- Similar patterns: [patterns to follow]
- Will reuse: [existing utilities]
- Risks: [potential issues noted]
```

---

## After Completing This Stage

Follow classification: S implements directly; M uses its brief plan, implementation, tests, and one fresh review; L proceeds to [2-architecture.md](2-architecture.md).
