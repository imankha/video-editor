# Bug Tracking System

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Replace email-based bug reports with a database-backed system where bugs are stored, viewable in the task board, and directly actionable by AI skills. Admin never copy-pastes from email -- AI loads full bug context with one command.

## Why

Today's flow: user reports problem -> email with attachments -> admin opens email, copies description + logs, pastes into Claude -> Claude investigates. Every bug requires manual data shuttling. Screenshots are base64-bloated email attachments. Logs are .txt files you have to open separately. No way to see all bugs at once, find duplicates, or track resolution.

Target flow: user reports problem -> data goes to Postgres + screenshot to R2 -> bug appears in task board -> admin says `/bug 42` -> AI has full context instantly -> AI investigates, consolidates with related bugs, promotes to task if needed -> reporter gets notified when fixed.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T3100 | [Bug Storage Backend](T3100-bug-storage-backend.md) | TODO |
| T3110 | [Bug Triage Skill](T3110-bug-triage-skill.md) | TODO |
| T3120 | [Task Board Bug View](T3120-task-board-bug-view.md) | TODO |
| T3130 | [Bug Lifecycle](T3130-bug-lifecycle.md) | TODO |

## Design Decisions

### Database: Postgres (not per-user SQLite)

Bugs are admin-facing, cross-user data. They belong in the shared Postgres DB alongside users, milestones, and referrals. Same access pattern as admin panel data.

### Screenshot storage: R2 (not email attachment)

Upload screenshot to R2 with a key like `bugs/{id}/screenshot.jpg`. Presigned URL for viewing. Eliminates base64 bloat in emails and makes screenshots accessible to AI via URL.

### Email becomes notification, not data transport

After this epic, the report-problem endpoint still sends an email -- but it's a lightweight notification with the bug description and a link. All data lives in the database. No more attachments.

### Bug vs Task distinction

Bugs are raw user reports. Tasks are planned work. A bug becomes a task when:
1. It's confirmed as a real issue (not user error, not duplicate)
2. It needs code changes to fix
3. Admin runs `/bug {id} promote` which creates a task file with the bug context pre-filled

Bugs that are user error, duplicates, or one-off transient issues get closed without becoming tasks.

### Consolidation logic

Multiple bug reports often stem from the same root cause. The triage skill identifies likely duplicates by comparing:
- Editor mode (same screen = likely related)
- Error messages in console logs (same error = likely same bug)
- Editor context similarity (same component state patterns)
- Time proximity (cluster of reports in short window = systemic issue)

This replaces the admin manually noticing "hmm, these 3 emails look similar."

## Completion Criteria

- [ ] Bug reports stored in Postgres with full context
- [ ] Screenshots stored in R2 (not email attachments)
- [ ] `/bug {id}` loads full context for AI investigation
- [ ] `/bugs` lists open bugs with consolidation suggestions
- [ ] Task board shows bugs alongside tasks
- [ ] Bugs can be promoted to tasks
- [ ] Reporter notified on resolution
- [ ] Email is notification-only (no data attachments)
