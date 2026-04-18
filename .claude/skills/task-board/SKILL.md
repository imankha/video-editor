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

## Portability

The tool works with any PLAN.md that uses:
- `###` or `####` section headers for milestones
- Markdown tables with an `| ID |` column for tasks

Copy `scripts/task-manager.py` to any project and it will auto-detect `docs/plans/PLAN.md` or accept a path argument.
