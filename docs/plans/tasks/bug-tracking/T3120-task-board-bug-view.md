# T3120: Task Board Bug View

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-05-24
**Updated:** 2026-05-25

## Problem

The task board (launched via `/task-board`) shows tasks from PLAN.md but has no visibility into bug reports. Admin has to context-switch between the task board and email to see what needs attention. Bugs should be visible alongside tasks so the admin can prioritize work across both.

## Solution

The task board automatically queries **both** prod and staging Postgres databases on every load and renders bugs under two milestones: "Production Reported Bugs" (first) and "Staging Reported Bugs" (second), above all PLAN.md milestones.

Bugs are grouped by likely root cause using deterministic heuristics (no LLM). Each bug card shows reporter, status, mode, description preview, and timestamp. The primary action is a **"Copy Kickoff Prompt"** button that downloads the screenshot + logs to local temp files and copies a complete AI prompt to the clipboard.

## Context

### Relevant Files
- `.claude/skills/task-board/` - Task board skill (reads PLAN.md, launches browser UI)
- `scripts/task-manager.py` - Local task board server + HTML/JS UI. Gets two new capabilities: (1) dual-DB fetch from prod + staging backends, (2) `POST /api/bug-kickoff` endpoint for downloading assets to local temp.
- `src/backend/app/routers/admin.py` - Admin bug API endpoints on remote backend (from T3100)

### Related Tasks
- Depends on: T3100 (Bug Storage Backend) - needs the API endpoints
- Complementary to: T3110 (Bug Investigation Skill) - `/bug {id}` for current-session investigation

### Technical Notes

**Dual-DB fetching:**

task-manager.py fetches bugs from both environments on load:
- Production: `https://reel-ballers-api.fly.dev/api/admin/bugs`
- Staging: `https://reel-ballers-api-staging.fly.dev/api/admin/bugs`

Both require admin auth (session cookie or header). The task board config needs backend URLs + auth credentials for both environments. Bugs from each are rendered under their respective milestone.

**Consolidation analysis (deterministic, no LLM):**

Within each environment, bugs are grouped by likely root cause using simple heuristics:

| Signal | Strength | Logic |
|--------|----------|-------|
| Same error message substring in console logs | Strong | Extract error-level log messages, compare substrings (first 100 chars). Exact or >80% overlap = match. |
| Same `editor_context.mode` | Weak | Same screen (annotate/framing/overlay). Alone not enough, but strengthens other signals. |
| Time cluster | Medium | 3+ bugs within 1 hour = likely systemic issue triggered by a deploy or data state. |
| Same `build` hash | Confirming | Same code version. Doesn't indicate same bug alone, but confirms other signals. |
| Same `page_url` pattern | Weak | Same route. Similar to mode. |

**Grouping algorithm:**
1. Extract error messages from each bug's `console_logs` (level = "error")
2. Compare all pairs using substring overlap (first significant error message)
3. Bugs with strong signal match + at least one weak signal = same group
4. Within each group, pick the bug with the most context (longest description, most log entries, has screenshot) as the **primary**
5. Remaining bugs in the group are candidates for **duplicate** marking

**Rendering groups in the task board:**
```
┌─ Group: Annotate timeline positioning (3 bugs) ──────────────┐
│                                                                │
│  [PRIMARY] Bug #5         2026-05-24 01:35                    │
│  Reporter: user@example.com                                   │
│  Mode: annotate | 18 clips | has screenshot                   │
│  "Clip icon placed in wrong part of timeline"                 │
│  [Copy Kickoff Prompt]  [Resolve Group]                       │
│                                                                │
│  Bug #7 — ADDS VARIANCE (different clip count: 12)            │
│  Bug #12 — LIKELY DUPLICATE (identical error + mode + build)  │
│                                                                │
└────────────────────────────────────────────────────────────────┘

[UNGROUPED] Bug #9         2026-05-24 03:12
Reporter: other@example.com
Mode: overlay | 3 clips
"Export button doesn't respond after clicking twice"
[Copy Kickoff Prompt]  [Resolve]
```

Grouped bugs show a collapsed view by default. The primary bug has the full card with Copy Kickoff Prompt. Secondary bugs show one line each with a label: "ADDS VARIANCE" (different editor state provides useful debugging context) or "LIKELY DUPLICATE" (identical signals, no new info).

"Resolve Group" marks the primary as resolved and auto-resolves all duplicates in the group (delegates to T3130's cascade logic).

**Copy Kickoff Prompt button (primary action):**

This is the main way bugs get worked on. When clicked:

1. **Task board JS calls local task-manager.py** (`POST /api/bug-kickoff`), passing the bug ID and the remote backend URL (prod or staging).

2. **task-manager.py (local Python server) handles the download:**
   - Fetches bug detail from remote backend (`GET /api/admin/bugs/{id}`)
   - Downloads screenshot via the presigned R2 URL to local temp (e.g., `C:\Users\...\AppData\Local\Temp\bug-42-screenshot.jpg`)
   - Writes console logs JSON to a local temp file (e.g., `C:\Users\...\AppData\Local\Temp\bug-42-logs.txt`)
   - Returns local file paths + full bug data in the response

   The local task-manager.py is the bridge -- the remote Fly.io backend can't write to the local filesystem, and the browser can't either. The local Python server can do both.

3. **Task board JS builds the prompt** from the returned data:
   ```
   Investigate and fix this production bug. Read CLAUDE.md for project context.

   ## Bug #42: Clip icon placed in wrong part of timeline

   **Reporter:** user@example.com
   **Reported:** 2026-05-24 01:35 UTC
   **Build:** abc123
   **Mode:** annotate

   ### Description
   {full description from user}

   ### Editor Context
   {formatted editor_context JSONB as readable table}

   ### Action Breadcrumbs
   {last N actions before the report}

   ### Console Logs
   See: C:\Users\...\AppData\Local\Temp\bug-42-logs.txt
   (Use reduce_log to analyze)

   ### Screenshot
   See: C:\Users\...\AppData\Local\Temp\bug-42-screenshot.jpg

   ### Related Bugs (same root cause group)
   - Bug #7: Same error, different clip count (12). Adds variance.
   - Bug #12: Likely duplicate (identical error + mode + build).
   ```

4. **Copy to clipboard** and show confirmation ("Copied! Paste into Claude to investigate.")

**Status actions (secondary):**
- Change status via dropdown (new -> investigating -> confirmed -> resolved)
- Mark as duplicate (select which bug it duplicates)
- Resolve with reason (resolved, not_a_bug, duplicate)
- Resolve Group (resolve primary + auto-close duplicates)
- Add admin notes

**Expandable detail view:**
Clicking a bug card expands to show full editor context, action breadcrumbs, log summary (first/last few lines), and screenshot thumbnail (loaded via presigned URL).

**No "Promote to Task" button.** Bugs stay as bugs. The Copy Kickoff Prompt replaces the old promote flow.

## Implementation

### Steps
1. [ ] Add dual-DB bug fetching to task-manager.py (prod + staging backend URLs, fetch `/api/admin/bugs` from both)
2. [ ] Implement deterministic consolidation grouping in task-manager.py (error message comparison, mode matching, time clustering)
3. [ ] Add `POST /api/bug-kickoff` endpoint to local task-manager.py -- fetches bug data + screenshot from remote backend, writes to local temp, returns file paths
4. [ ] Render "Production Reported Bugs" and "Staging Reported Bugs" milestones above PLAN.md milestones
5. [ ] Render bug groups: primary bug with full card, secondary bugs as one-liners with ADDS VARIANCE / LIKELY DUPLICATE labels
6. [ ] Render ungrouped bugs as standalone cards
7. [ ] Implement "Copy Kickoff Prompt" button: call local `/api/bug-kickoff`, build prompt with returned file paths + related bugs, copy to clipboard
8. [ ] Add expandable detail view (full editor context, breadcrumbs, log summary, screenshot)
9. [ ] Add status update actions (dropdown, mark duplicate, resolve group)
10. [ ] Style consistently with existing task board design

## Acceptance Criteria

- [ ] Task board automatically fetches bugs from both prod and staging Postgres on every load
- [ ] "Production Reported Bugs" and "Staging Reported Bugs" milestones appear above all PLAN.md milestones
- [ ] Bugs are grouped by likely root cause using deterministic heuristics (no LLM)
- [ ] Groups show primary bug (most context) with full card, secondary bugs as labeled one-liners
- [ ] Bug cards display reporter, status, mode, and description preview
- [ ] "Copy Kickoff Prompt" downloads screenshot + logs to local temp and copies complete prompt to clipboard
- [ ] Copied prompt includes all bug context + local file paths + related bugs from same group
- [ ] Clicking a bug shows full detail (editor context, breadcrumbs, log summary, screenshot)
- [ ] Admin can update bug status, mark duplicates, and resolve groups
- [ ] Bugs section loads from API (requires at least one backend running; gracefully handles if one env is unreachable)
