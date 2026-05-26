# Bug Tracking System

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Replace email-based bug reports with a database-backed system where bugs are stored in Postgres (one per environment), viewable in the task board under "Production Reported Bugs" and "Staging Reported Bugs" milestones, and directly actionable via a "Copy Kickoff Prompt" button that downloads assets locally and generates a ready-to-paste AI prompt.

## Why

Today's flow: user reports problem -> email with attachments -> admin opens email, copies description + logs, pastes into Claude -> Claude investigates. Every bug requires manual data shuttling. Screenshots are base64-bloated email attachments. Logs are .txt files you have to open separately. No way to see all bugs at once, find duplicates, or track resolution.

Target flow: user reports problem -> data goes to Postgres + screenshot to R2 -> task board auto-fetches from both prod and staging Postgres on every load -> bugs appear under the correct environment milestone, grouped by likely root cause -> admin clicks "Copy Kickoff Prompt" (downloads screenshot + logs to temp, builds prompt with local file paths + related bugs) -> pastes into Claude -> Claude investigates with full context -> admin resolves bug, duplicates auto-close.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T3100 | [Bug Storage Backend](T3100-bug-storage-backend.md) | TODO |
| T3110 | [Bug Investigation Skill](T3110-bug-triage-skill.md) | TODO |
| T3120 | [Task Board Bug View](T3120-task-board-bug-view.md) | TODO |
| T3130 | [Bug Resolution & Dedup Lifecycle](T3130-bug-lifecycle.md) | TODO |

## Design Decisions

### Database: Postgres (environment-implicit)

Bugs are admin-facing, cross-user data. They belong in the shared Postgres DB alongside users, milestones, and referrals. **The environment is implicit** -- prod Postgres holds prod bugs, staging Postgres holds staging bugs. No `environment` column needed; the DB instance itself is the environment discriminator.

### Task board auto-fetches from both databases

The task board (task-manager.py) queries both prod and staging backend APIs on every load. No separate `/bugs` skill needed for listing -- the task board IS the bug list. Bugs are rendered under "Production Reported Bugs" and "Staging Reported Bugs" milestones above all PLAN.md milestones.

### No promotion to task files

Bugs stay as bugs in Postgres. They do NOT get promoted to task files in PLAN.md. The workflow is:
1. Bug appears in task board automatically (fetched from both prod + staging Postgres)
2. Admin clicks "Copy Kickoff Prompt" to get a prompt with full context + downloaded assets
3. Admin pastes prompt into a fresh Claude session to investigate and fix
4. Admin resolves the bug in the task board when fixed

For current-session investigation, `/bug {id}` loads the bug context without starting a fresh session.

### Screenshot storage: R2 (not email attachment)

Upload screenshot to R2 with a key like `bugs/{id}/screenshot.jpg`. Presigned URL for viewing. Eliminates base64 bloat in emails and makes screenshots accessible to AI via local file download.

### Email becomes notification, not data transport

After this epic, the report-problem endpoint still sends an email -- but it's a lightweight notification with the bug description and a link. All data lives in the database. No more attachments.

### Copy Kickoff Prompt (primary action)

The task board's "Copy Kickoff Prompt" button for bugs:
1. Downloads screenshot image from R2 to a local temp path (via local task-manager.py server)
2. Downloads console logs to a local temp file
3. Builds a prompt containing: bug description, editor context, action breadcrumbs, reporter info, related bugs from the same group, and **local file paths** for the screenshot and log file so Claude can read them
4. Copies the prompt to clipboard

This replaces the old "promote to task" flow. The admin pastes into Claude and starts working immediately.

### Smart consolidation (deterministic, no LLM)

Consolidation runs in task-manager.py using deterministic heuristics -- no LLM or API calls. Within each environment:

- **Error message matching** (strong signal): Compare error-level log messages by substring overlap
- **Same editor mode** (weak signal): Same screen (annotate/framing/overlay)
- **Time clustering** (medium signal): 3+ bugs within 1 hour = likely systemic issue
- **Same build hash** (confirming): Same code version

Bugs with matching signals are grouped. Within each group:
- The bug with the most context (longest description, most log entries, has screenshot) is the **primary**
- Bugs that add different editor states or paths to the same error are labeled **ADDS VARIANCE**
- Bugs with identical signals across the board are labeled **LIKELY DUPLICATE**
- Resolving the primary auto-resolves all duplicates (T3130)

## Completion Criteria

- [ ] Bug reports stored in Postgres with full context
- [ ] Screenshots stored in R2 (not email attachments)
- [ ] Task board auto-fetches from both prod and staging Postgres on every load
- [ ] Bugs shown under "Production Reported Bugs" and "Staging Reported Bugs" milestones
- [ ] Bugs grouped by likely root cause using deterministic heuristics (no LLM)
- [ ] "Copy Kickoff Prompt" downloads screenshot + logs locally and copies a complete AI prompt with related bugs
- [ ] `/bug {id}` loads full context for current-session AI investigation
- [ ] Smart dedup: duplicates auto-resolve when primary bug is fixed
- [ ] Email is notification-only (no data attachments)
