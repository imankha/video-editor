# T3130: Bug Resolution & Dedup Lifecycle

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-24
**Updated:** 2026-05-25

## Problem

After a bug is investigated and fixed, there's no structured way to: (1) close it with a resolution, (2) auto-resolve duplicates when the root cause is fixed, or (3) let the reporter know it was addressed. The lifecycle from report to resolution is entirely manual.

## Solution

Two capabilities that close the bug lifecycle loop:

### 1. Resolve Bug + Auto-Close Duplicates

Close a bug with a resolution status. When a bug that has duplicates pointing to it is resolved, **all its duplicates are automatically resolved too** -- no manual cleanup needed.

**Statuses:**
- `resolved` - Fixed in code, deployed
- `not_a_bug` - User error or expected behavior
- `duplicate` - Same root cause as another bug (sets `duplicate_of`)

**Flow:** Status change in task board or `/bug {id} resolve [status]` ->
- Sets `resolved_at` timestamp
- Sets resolution status + optional admin note
- If this bug has duplicates (`WHERE duplicate_of = {id}`), auto-set all to `resolved` with note "Auto-resolved: root cause fixed in Bug #{id}"

**Smart dedup decision-making:**

When the `/bugs` triage skill identifies a consolidation group, the admin (or AI) decides:

1. **Which report is primary?** Pick the one with the most context (detailed description, error stack traces, more editor state data).
2. **Which reports add variance?** Keep visible -- they show the bug manifests across different states (different game sizes, clip counts, editor modes). Reference these during investigation.
3. **Which reports are pure duplicates?** Mark as `duplicate` of the primary. These have identical error messages, same editor mode, same build -- no new debugging info. They auto-resolve when the primary is fixed.

### 2. Reporter Notification (Optional)

When a bug is resolved, optionally email the reporter a brief update. Only if they provided an email. Lightweight -- one sentence, not a full report.

**Email template:**
```
Subject: Your report was addressed (#42)
Body: Thanks for reporting "{description_preview}". We've fixed the issue
and it should be resolved in the current version. -- Reel Ballers team
```

For `not_a_bug`: "Thanks for reporting. We looked into this and it appears to be working as expected. If you're still seeing issues, please report again with more detail."

For `duplicate`: No email (the original report's resolution notification covers it).

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` - Bug API endpoints (from T3100)
- `src/backend/app/services/email.py` - Email sending (for reporter notification)
- `.claude/skills/bug-triage/SKILL.md` - Bug triage skill (from T3110)

### Related Tasks
- Depends on: T3100 (Bug Storage Backend), T3110 (Bug Triage Skill)

### Technical Notes

**Auto-resolve query:**
```sql
-- When resolving bug #42, auto-resolve all its duplicates
UPDATE bug_reports
SET status = 'resolved',
    resolved_at = NOW(),
    updated_at = NOW(),
    admin_notes = COALESCE(admin_notes || E'\n', '') || 'Auto-resolved: root cause fixed in Bug #42'
WHERE duplicate_of = 42
  AND status != 'resolved';
```

**Reporter notification rate limiting:**
- Only send for `resolved` and `not_a_bug` statuses (not for investigate/confirm transitions)
- Max 1 notification per bug (don't re-notify if status changes again)
- Skip if no reporter_email
- Skip for `duplicate` status (original report notification covers it)

**Token efficiency principle:**
The triage skill's consolidation analysis should explicitly recommend which reports to investigate vs. ignore. When 5 users report the same thing:
- If they all hit the same error on the same screen with the same build: investigate 1, mark 4 as duplicates
- If they show different paths to the same error (different game sizes, different clip counts, different actions leading to it): investigate the primary, reference the variant reports for edge cases, mark truly identical ones as duplicates

The goal: maximize debugging context from the reports without wasting tokens loading identical information multiple times.

## Implementation

### Steps
1. [ ] Add auto-resolve logic to PATCH endpoint: when status changes to `resolved`, cascade to all bugs with `duplicate_of = {id}`
2. [ ] Add resolve logic: set `resolved_at`, update status
3. [ ] Create reporter notification email template in email.py
4. [ ] Send notification on resolve (with rate limiting + skip rules)
5. [ ] Wire up resolve and mark-duplicate actions in task board (from T3120)

## Acceptance Criteria

- [ ] Resolved bugs get a `resolved_at` timestamp
- [ ] Resolving a primary bug auto-resolves all its duplicates
- [ ] Auto-resolved duplicates get an admin note explaining which bug fixed them
- [ ] Reporter receives email notification on resolution (if email provided)
- [ ] Duplicate bugs link to the original via `duplicate_of`
- [ ] No notification sent for `duplicate` status changes
- [ ] Max 1 notification per bug lifetime
