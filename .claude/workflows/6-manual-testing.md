# Stage 6: Test & Fix Agent Handoff

## Purpose

Generate a self-contained handoff prompt that the user takes into a **new conversation** with the Test & Fix Agent. That agent will help the user manually test the feature in the browser, debug any issues found, and fix implementation bugs.

This is a **conversation boundary** -- the implementation AI's job ends here. The user starts a fresh session with only the handoff document as context, keeping that conversation focused and context-efficient.

---

## Checklist

### 1. Pre-Handoff Cleanup

**Remove temporary code before generating handoff:**
- [ ] No `console.log` statements (frontend)
- [ ] No debug `print()` statements (backend)
- [ ] No commented-out code blocks
- [ ] No TODO comments for this task

### 2. Generate Testing Handoff Prompt

**Create file:** `docs/plans/tasks/T{id}-testing-kickoff.md`

Use this template:

```markdown
# T{id} Test & Fix: {Task Title}

## Task

Read this handoff document and help me test, debug, and fix T{id}: {brief description}.

## What Was Built

{1-2 sentence summary of what the feature does from the user's perspective}

**Branch:** `feature/T{id}-{description}`
**Status:** TESTING (all automated tests pass)

---

## Architecture

{ASCII diagram showing the user flow end-to-end}

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| {path} | {brief description} |

### Frontend
| File | Change |
|------|--------|
| {path} | {brief description} |

### Tests
| File | Tests |
|------|-------|
| {path} | {count} tests |

---

## How to Test Manually

### Prerequisites
{What needs to be running, any migrations to apply, test data needed}

### Auth Bypass (for browser testing)
{Include the standard e2e auth bypass snippet}

### Test Flow
{Step-by-step instructions to exercise the golden path}

### Edge Cases to Test
{Numbered list of edge cases with expected behavior}

---

## Known Potential Issues

{Numbered list of things that might break, with symptoms and fixes}

---

## Running Automated Tests

{Exact commands to run backend + frontend tests}

---

## Key Code Locations for Debugging

| What | Where |
|------|-------|
| {feature aspect} | {file:line or description} |

---

## Acceptance Criteria

- [ ] {criterion 1}
- [ ] {criterion 2}
- [ ] ...
```

### 4. Key Principles for the Handoff

The handoff must be **self-contained** -- the Test & Fix Agent should NOT need to read the original task file, epic, or kickoff prompt. Include:

1. **All file paths and line numbers** for debugging entry points
2. **The exact auth bypass snippet** (don't just reference it)
3. **Symptoms + fixes** for known issues (e.g., "if you see X, run Y")
4. **Architecture diagram** so the agent understands data flow when debugging
5. **Acceptance criteria** as a checklist to verify

### 5. Commit the Handoff

```bash
git add docs/plans/tasks/T{id}-testing-kickoff.md
git commit -m "docs: T{id} testing handoff prompt"
```

### 6. Notify User

```
T{id} is ready for testing.

**Automated tests:** {X} backend + {Y} frontend passing

**To start testing:** Open a new conversation and say:
"Read `docs/plans/tasks/T{id}-testing-kickoff.md` and help me test and fix T{id}."

The Test & Fix Agent has everything it needs in that file to help you
test in the browser, debug issues, and fix any problems found.
```

---

## What the Test & Fix Agent Does

The user works with a fresh AI session that:

1. **Reads the handoff** to understand what was built
2. **Helps test in browser** using Playwright MCP or manual instructions
3. **Debugs failures** by reading logs, checking code at specified locations
4. **Fixes bugs** directly on the feature branch
5. **Re-runs tests** to verify fixes don't break existing coverage
6. **Reports back** to the user when all acceptance criteria pass

The Test & Fix Agent can modify code, run tests, and commit fixes -- it has full access to the branch. It does NOT merge or deploy.

---

## After User Approves

When the user says "approved", "that worked", "looks good", or "done":

Proceed to [7-task-complete.md](7-task-complete.md) to finalize (may happen in the same or original conversation).
