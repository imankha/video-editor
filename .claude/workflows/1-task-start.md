# Stage 1: Task Start

## Checklist

### 1. Create Feature Branch
```bash
git checkout -b feature/T{id}-{short-description}
```

### 2. Read Task File
- Read `docs/plans/tasks/T{id}-*.md`
- Understand the problem, solution, and acceptance criteria
- Note any referenced files or screenshots

### 3. Run Code Expert Agent

**Spawn the Code Expert agent** to audit the codebase:

```
Use Task tool with subagent_type: Explore

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

Proceed to [2-test-first.md](2-test-first.md) to create failing tests.
