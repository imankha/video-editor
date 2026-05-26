# T3110: Bug Investigation Skill

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-24
**Updated:** 2026-05-25

## Problem

When a bug needs investigation in the current Claude session (without switching to a fresh one), the admin has to manually fetch the bug data, copy logs, and provide context. The `/bug {id}` skill loads everything automatically.

## Solution

A Claude Code skill (`/bug {id}`) that loads a specific bug's full context from Postgres into the current conversation for investigation.

**This skill is NOT for listing bugs or consolidation.** The task board (T3120) handles that automatically by querying both prod and staging Postgres on every load.

**When to use `/bug {id}` vs Copy Kickoff Prompt:**
- `/bug {id}`: Quick investigation in the current session. Already in context, want to look at a bug without starting fresh.
- Copy Kickoff Prompt (task board): Full investigation in a fresh session with downloaded screenshot + logs. The primary workflow for focused bug fixing.

## Context

### Relevant Files
- `.claude/skills/` - Existing skill definitions
- `src/backend/app/routers/admin.py` - Admin bug API endpoints (from T3100)
- `src/backend/app/services/pg.py` - Postgres access

### Related Tasks
- Depends on: T3100 (Bug Storage Backend) - needs the DB + API
- Complementary to: T3120 (Task Board Bug View) - task board lists bugs + consolidation; this skill investigates one

### Technical Notes

**Skill definition:** `.claude/skills/bug-triage/SKILL.md`

**`/bug {id}` flow:**
1. Fetch bug detail from `GET /api/admin/bugs/{id}` (or direct Postgres read)
2. Display structured summary:
   - Reporter, timestamp, build, status
   - Editor mode + context (formatted as a readable table)
   - Action breadcrumbs (last N actions before report)
3. Load console logs (use reduce_log on the log data if large)
4. Display screenshot if available (read from R2 URL)
5. Search codebase based on the editor context (mode, component, error messages)
6. Suggest root cause and affected files

**Example formatted output:**
```
Mode: annotate
Game: #7
Clips: 18 total
  #15: start=495s end=510s rating=4 seq=1
  #16: start=470s end=515s rating=4 seq=1  <-- starts BEFORE #15
  #17: start=500s end=520s rating=4 seq=1
```

## Implementation

### Steps
1. [ ] Create skill definition at `.claude/skills/bug-triage/SKILL.md`
2. [ ] Implement `/bug {id}` - fetch, format, display, start investigation
3. [ ] Add ability to update bug status from within the skill
4. [ ] Test with real bug data from the database

## Acceptance Criteria

- [ ] `/bug {id}` loads full context and displays it in a structured, readable format
- [ ] AI can start investigating immediately without any manual data gathering
- [ ] Bug status can be updated from within the skill
- [ ] Screenshot is viewable when available
