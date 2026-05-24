# T3130: Bug Lifecycle

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-24
**Updated:** 2026-05-24

## Problem

After a bug is investigated, there's no structured way to: (1) convert it into a tracked task, (2) close it with a resolution, or (3) let the reporter know it was fixed. The lifecycle from report to resolution is entirely manual.

## Solution

Three capabilities that close the bug lifecycle loop:

### 1. Promote to Task
Convert a confirmed bug into a task file. Pre-fills the task template with bug context so the implementing agent has full debugging data without manual copy-paste.

**Flow:** `/bug {id} promote` or button in task board ->
- Creates `docs/plans/tasks/T{next_id}-{slug}.md` with:
  - Problem section filled from bug description + editor context
  - Technical Notes section with console log summary, action breadcrumbs
  - Link back to original bug report
- Adds task to PLAN.md in the Bugs section
- Updates bug status to `promoted`, sets `task_id`

### 2. Resolve Bug
Close a bug with a resolution status and optional note.

**Statuses:**
- `resolved` - Fixed in code, deployed
- `not_a_bug` - User error or expected behavior
- `duplicate` - Same as another bug (sets `duplicate_of`)
- `wont_fix` - Known issue, not worth fixing

**Flow:** `/bug {id} resolve [status]` or status change in task board ->
- Sets `resolved_at` timestamp
- Sets resolution status + optional admin note

### 3. Reporter Notification
When a bug is resolved, optionally email the reporter a brief update. Only if they provided an email. Lightweight -- one sentence, not a full report.

**Email template:**
```
Subject: Your report was addressed (#42)
Body: Thanks for reporting "{description_preview}". We've fixed the issue
and it should be resolved in the current version. -- Reel Ballers team
```

For `not_a_bug`: "Thanks for reporting. We looked into this and it appears to be working as expected. If you're still seeing issues, please report again with more detail."

For `duplicate`: No email (the original report's resolution covers it).

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` - Bug API endpoints (from T3100)
- `src/backend/app/services/email.py` - Email sending (for reporter notification)
- `.claude/skills/bug-triage/SKILL.md` - Bug triage skill (from T3110)
- `.claude/skills/task-management/SKILL.md` - Task creation patterns
- `docs/plans/PLAN.md` - Task list (for promote-to-task insertion)

### Related Tasks
- Depends on: T3100 (Bug Storage Backend), T3110 (Bug Triage Skill)

### Technical Notes

**Promote-to-task template:**
```markdown
# T{ID}: {Bug description, cleaned up as title}

**Status:** TODO
**Impact:** {inherited from bug severity or set by admin}
**Complexity:** {estimated}
**Created:** {today}
**Updated:** {today}
**Bug Report:** #{bug_id} (reported {bug.created_at} by {bug.reporter_email})

## Problem

{bug.description}

### Bug Context

**Editor state at time of report:**
{formatted editor_context}

**Recent user actions:**
{formatted action breadcrumbs}

**Console errors/warnings:**
{summary of relevant log entries}

## Solution

{to be filled in during architecture stage}
```

**Reporter notification rate limiting:**
- Only send for `resolved` status (not for investigate/confirm transitions)
- Max 1 notification per bug (don't re-notify if status changes again)
- Skip if no reporter_email

## Implementation

### Steps
1. [ ] Add promote endpoint: `POST /api/admin/bugs/{id}/promote` - creates task file, updates PLAN.md, sets bug status
2. [ ] Add resolve logic to existing PATCH endpoint (set resolved_at, send notification)
3. [ ] Create reporter notification email template in email.py
4. [ ] Integrate promote/resolve actions into bug triage skill
5. [ ] Wire up promote/resolve buttons in task board (from T3120)

## Acceptance Criteria

- [ ] Confirmed bugs can be promoted to tasks with pre-filled context
- [ ] Promoted task file contains all relevant bug data (description, editor context, logs)
- [ ] Bug status updates to `promoted` with link to created task
- [ ] Resolved bugs get a `resolved_at` timestamp
- [ ] Reporter receives email notification on resolution (if email provided)
- [ ] Duplicate bugs link to the original via `duplicate_of`
