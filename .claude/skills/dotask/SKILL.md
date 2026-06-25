---
name: dotask
description: "Kick off a task in a permission-free container worker from the GUI supervisor session: generate the kickoff prompt, start the container, and open a VS Code window attached to it (image paste works). No Git Bash, no copy-paste."
license: MIT
author: video-editor
version: 2.0.0
user_invocable: true
---

# /dotask

Turn a planned task into a working container session with no copy-paste and no Git Bash.

## Roles

- **Supervisor** = the VS Code Claude Code session the user is chatting in (GUI, image paste).
  This skill runs HERE. You (the supervisor) drive everything via tools; the user never opens
  a terminal.
- **Worker** = a per-task Docker container (`scripts/task.sh`). The user collaborates with the
  worker in its OWN attached VS Code window (also GUI + image paste).

## When to Apply

- User says `/dotask <id>` (e.g. `/dotask T3940`), "kick off T3940", "start T3940 in a sandbox".
- `<id>` is a task id from `docs/plans/PLAN.md` (a `T####`), possibly in an epic subfolder.

## Procedure (supervisor runs these via tools)

1. **Resolve the task file.** Glob `docs/plans/tasks/**/T<id>-*.md`. If zero/multiple match, list
   candidates and ask. Let `SLUG = t<id lowercased>` (e.g. `T3940` -> `t3940`).

2. **Read context.** Read the task file in full, plus `CLAUDE.md`; if it references an `EPIC.md`,
   read that too. Skim key "Relevant Files" so the kickoff is concrete.

3. **Generate a READY-TO-USE kickoff prompt** following the kickoff template in
   [task-management/SKILL.md](../task-management/SKILL.md) (the "Kickoff Prompt" section). It is
   the EXPANDED prompt the worker acts on directly -- NOT the meta "Create a kickoff prompt..."
   wrapper. Fill in every value (no `{placeholders}`/`~{n}`): Stage-0 classification, agent table,
   applied/skipped stages with reasons, task-specific steps, key rules. Start with
   `Implement T<id>: <title>`; tell the worker to follow the standard workflow (classify -> branch
   -> implement -> test) and NOT to change task statuses (the user promotes manually).

4. **Write the prompt** to `C:\tmp\kickoff-<SLUG>.md` with the Write tool. (The same file is
   `/c/tmp/kickoff-<SLUG>.md` in the Bash-tool / Git Bash path form used in step 6 -- pass the
   FORWARD-SLASH form to bash; a backslash `C:\tmp\...` gets mangled by MSYS into `C:tmp...`.)

5. **Pre-flight Docker.** Run `docker info` (via Bash). If Docker isn't running, tell the user to
   start Docker Desktop and stop here -- containers need it.

6. **Start the worker + open its GUI window** (single command, via Bash):
   ```
   bash scripts/task.sh code <SLUG> --prompt-file /c/tmp/kickoff-<SLUG>.md
   ```
   This: ensures the container is up (first run builds the image + installs deps, a few minutes),
   seeds the kickoff to `/workspace/.dotask-kickoff.md` inside it, and opens a VS Code window
   ATTACHED to the container. The first attach installs the VS Code server + extensions in the
   container (~1 min).

7. **Tell the user** a VS Code worker window for `<id>` is opening, and to start it by sending one
   line in that window's Claude panel:
   `Implement /workspace/.dotask-kickoff.md`
   Image paste works there. Note the new project skill won't appear in the worker until it's on
   master (the skill registry reads the main checkout).

## Notes

- **Terminal worker instead (hands-off/autonomous):** `bash scripts/task.sh <SLUG> --prompt-file
  /c/tmp/kickoff-<SLUG>.md` launches a CLI Claude session pre-fed with the prompt (no GUI, no image
  paste). Use only when you don't need to chat with the worker.
- **Second window on the same task:** `bash scripts/task.sh code <SLUG>` (no prompt file) attaches
  another VS Code window to the same container/files.
- **Run the app / test it:** `bash scripts/task.sh stack <SLUG>` (open the printed port from the
  host browser), or `bash scripts/task.sh test <SLUG>` for the headless Playwright E2E suite.
- **Bugs:** for a bug id, use the bug-triage skill to assemble context, write it as the prompt
  file, and launch with a `bug-<id>` SLUG.
- **Teardown:** `bash scripts/task.sh down <SLUG>` (keep checkout) or `nuke <SLUG>` (delete it).
