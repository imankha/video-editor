---
name: task-board
description: "Launch a browser-based task board for drag-and-drop reordering, deletion, and milestone reassignment. Reads PLAN.md and writes changes back on save."
license: MIT
author: video-editor
version: 1.0.0
user_invocable: true
---

# Task Board

Launch the interactive task board UI in the browser.

## When to Apply

- User asks to "show tasks", "see tasks", "task board", "manage tasks", "reorder tasks", "prioritize tasks"
- User asks to view or rearrange the task list visually
- User says "tasks" in a context that implies wanting to see/manage them

## What It Does

Starts a local Python server that:
1. Parses `docs/plans/PLAN.md` (auto-detected or passed as argument)
2. Serves a drag-and-drop UI at `http://localhost:8089`
3. Opens the browser automatically
4. Writes changes back to PLAN.md when the user clicks Save

## How to Launch

Run this command to start the server fully detached (AI does not wait for it):

```bash
cd <project-root> && python scripts/task-manager.py > /dev/null 2>&1 & disown
```

Then tell the user the board is open at http://localhost:8089. Do NOT use `run_in_background` — the server is fire-and-forget.

## What the Board Shows

**Statuses** (see CLAUDE.md Task Status Rule for who owns each):

| Badge | Meaning |
|-------|---------|
| `TODO` | Not started |
| `WIP` | AI actively working it |
| `WAITING ON USER` | Blocked on you: design approval, a question, a test verdict, or a branch awaiting merge |
| `STAGING` | Merged to master and auto-deployed to staging |
| `DONE` | Deployed to prod — hidden by default ("Hide done" checkbox) |

The **Resolve** button appears on any in-flight row and promotes it straight to DONE.

**Branch on hover.** Rows with a branch show a `⑂` glyph; hovering the task name (or the glyph) lists the branches, each tagged `local only` / `pushed` / `merged`. Nothing is stored in PLAN.md — the server derives it from git on each load:

1. Branch names containing the task id (`feature/T5683-...`).
2. For branches NOT named after a task — a wave's `integration/*` branch, a `fix/*` branch — any commit subject on that branch (not yet on master) mentioning `T5683`. This is what keeps a task attributed after a wave is collapsed into one integration branch and the per-task branches are deleted. Branches already named for a task are excluded from this pass, otherwise sibling commits inherited from the base branch would be misattributed.

The server runs `git fetch --prune origin` in the background at startup so branches pushed by container workers resolve. The lookup is cached for 30s; `GET /api/branches?fetch=1` forces a re-fetch.

## Portability

The tool works with any PLAN.md that uses:
- `###` or `####` section headers for milestones
- Markdown tables with an `| ID |` column for tasks

Copy `scripts/task-manager.py` to any project and it will auto-detect `docs/plans/PLAN.md` or accept a path argument.
