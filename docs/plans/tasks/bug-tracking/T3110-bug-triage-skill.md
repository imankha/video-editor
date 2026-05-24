# T3110: Bug Triage Skill

**Status:** TODO
**Impact:** 10
**Complexity:** 5
**Created:** 2026-05-24
**Updated:** 2026-05-24

## Problem

When a bug report comes in, the admin currently reads an email, manually copies the description and log file into a Claude conversation, and asks Claude to investigate. This loses structured data (editor context becomes plain text), requires manual effort for every bug, and makes it impossible to cross-reference with other open bugs.

## Solution

A Claude Code skill (`/bug`) that loads full bug context from the database and drives the investigation workflow. Two modes:

1. **`/bug {id}`** - Load a specific bug's full context (description, editor context, action breadcrumbs, console logs, screenshot) and start investigating. AI has everything it needs without any copy-paste.

2. **`/bugs`** - List all open bugs with a summary. Analyze for consolidation: flag bugs that likely share a root cause based on shared editor mode, similar errors, similar context, or time clustering.

## Context

### Relevant Files
- `.claude/skills/` - Existing skill definitions
- `src/backend/app/routers/auth.py` - Admin bug API endpoints (from T3100)
- `src/backend/app/services/pg.py` - Postgres access

### Related Tasks
- Depends on: T3100 (Bug Storage Backend) - needs the DB + API
- Blocks: T3130 (Bug Lifecycle) - promote/resolve actions build on this skill

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

**`/bugs` flow:**
1. Fetch all open bugs (`GET /api/admin/bugs?status=new,investigating,confirmed`)
2. Display summary table: id, reporter, mode, description preview, created_at
3. Run consolidation analysis:
   - Group by editor mode
   - Compare error messages in console logs (fuzzy match)
   - Compare editor context patterns (same component state)
   - Flag time clusters (3+ bugs within 1 hour = systemic)
4. Output: "Bugs #5, #7, #12 are all annotate timeline issues with similar console errors -- likely same root cause. Recommend investigating #5 first (most context)."

**Consolidation heuristics:**
- Same `editor_context.mode` → weak signal (same screen)
- Same error message substring in logs → strong signal
- Same `editor_context.annotate.clipCount` range + same mode → medium signal
- Created within 1 hour of each other → time cluster signal
- Same `page_url` pattern → weak signal
- Same `build` hash → confirms same code version

**Bug context as AI prompt context:**
The skill should format the bug data so it naturally feeds into the investigation. For example, the editor context for the clip positioning bug would have shown:
```
Mode: annotate
Game: #7
Clips: 18 total
  #15: start=495s end=510s rating=4 seq=1
  #16: start=470s end=515s rating=4 seq=1  <-- starts BEFORE #15
  #17: start=500s end=520s rating=4 seq=1
```
This immediately reveals the sort/position mismatch without any investigation.

## Implementation

### Steps
1. [ ] Create skill definition at `.claude/skills/bug-triage/SKILL.md`
2. [ ] Implement `/bug {id}` - fetch, format, display, start investigation
3. [ ] Implement `/bugs` - list open bugs with summary table
4. [ ] Implement consolidation analysis logic
5. [ ] Add ability to update bug status from within the skill (`/bug {id} status investigating`)
6. [ ] Test with real bug data from the database

## Acceptance Criteria

- [ ] `/bug {id}` loads full context and displays it in a structured, readable format
- [ ] `/bugs` lists all open bugs with status, mode, and description
- [ ] Consolidation analysis identifies likely-duplicate bugs with reasoning
- [ ] AI can start investigating immediately after `/bug {id}` without any manual data gathering
- [ ] Bug status can be updated from within the skill
- [ ] Screenshot is viewable when available
