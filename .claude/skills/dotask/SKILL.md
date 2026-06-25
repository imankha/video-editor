---
name: dotask
description: "Kick off a task in a permission-free sandbox in one step: generate the kickoff prompt and auto-launch a Git Bash sandbox window that starts working on it. Replaces the copy-the-board-prompt -> paste-into-a-chat -> copy-result -> paste-into-git-bash chain."
license: MIT
author: video-editor
version: 1.0.0
user_invocable: true
---

# /dotask

Turn a planned task into a working sandbox session with no copy-paste.

## When to Apply

- User says `/dotask <id>` (e.g. `/dotask T3940`), or "kick off T3940", "start T3940 in a sandbox", "dotask 3940".
- `<id>` is a task id from `docs/plans/PLAN.md` (a `T####`). It may live in an epic subfolder.

This skill runs in the **normal host session** (where you have permission prompts and can
launch processes). It does NOT run inside a container.

## What It Replaces

The old flow was: board "Copy kickoff prompt" -> paste into a chat to expand it -> copy the
result -> board "Sandbox cmd" -> paste into Git Bash -> paste the prompt. This skill does the
expand step itself and launches the sandbox window pre-fed, so the user does nothing manual.

## Procedure

1. **Resolve the task file.** Glob `docs/plans/tasks/**/T<id>-*.md` (the id may be under an
   epic subfolder). If zero or multiple match, list candidates and ask which one. Let
   `SLUG = t<id lowercased>` (e.g. `T3940` -> `t3940`); this is the sandbox/container id.

2. **Read context.** Read the matched task file in full, plus `CLAUDE.md` (workflow rules,
   coding principles) and, if the task file references an `EPIC.md`, read that too. If the
   task file's "Relevant Files" section names files, skim the key ones so the kickoff is
   concrete, not generic.

3. **Generate a READY-TO-USE kickoff prompt** following the kickoff template in
   [task-management/SKILL.md](../task-management/SKILL.md) (the "Kickoff Prompt" section).
   It must be the *expanded* prompt the sandbox session will act on directly -- NOT the meta
   "Create a kickoff prompt..." wrapper the board copies. Fill in every value (no `{placeholders}`,
   no `~{n}`): the actual Stage-0 classification, the agent table, which stages apply/are skipped
   and why, task-specific steps, and key rules. Start it with `Implement T<id>: <title>` and tell
   the session to follow the standard workflow (classify -> branch -> implement -> test). It
   should NOT change task statuses (the user promotes manually -- see CLAUDE.md).

4. **Write the prompt to a temp file** at `C:\tmp\kickoff-<SLUG>.md` using the Write tool
   (writes LF). `C:\tmp` is a registered working dir.

5. **Launch the sandbox window:**
   ```
   powershell -ExecutionPolicy Bypass -File scripts/open-task-window.ps1 -Id <SLUG> -PromptFile C:\tmp\kickoff-<SLUG>.md
   ```
   This opens a new Git Bash (mintty) window that runs
   `bash scripts/task.sh <SLUG> --prompt-file <the file>`: the launcher seeds the prompt into
   the container over stdin (no quoting/MSYS mangling) and starts Claude with it. First run of
   a sandbox builds the image + installs deps (a few minutes); later runs are fast.

6. **Report and give the fallback.** Tell the user a sandbox window for `<id>` is opening and
   will start on its own. ALWAYS also print the exact manual command, in case the window
   doesn't appear (e.g. mintty path differs):
   ```bash
   bash scripts/task.sh <SLUG> --prompt-file /c/tmp/kickoff-<SLUG>.md
   ```

## Notes

- **Second chat on the same task:** `bash scripts/task.sh claude <SLUG>` (no prompt file)
  attaches another session to the same container/files.
- **Run the app / test it:** `bash scripts/task.sh stack <SLUG>` (open the printed port), or
  `bash scripts/task.sh test <SLUG>` to run the Playwright E2E suite headless in the container.
- **Need image paste / a GUI chat?** A terminal Claude session can't paste images.
  `bash scripts/task.sh code <SLUG>` opens VS Code ATTACHED to the same container -- run the
  Claude extension there for full GUI + image paste (still permission-free). The kickoff prompt
  is at `/workspace/.dotask-kickoff.md` inside the container if you want to reference it there.
- **Bugs:** for a bug id use the bug-triage skill to assemble context first, then write that as
  the prompt file and launch with a `bug-<id>` SLUG.
