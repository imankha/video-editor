---
name: dotask
description: "Kick off a task in a permission-free CLI worker inside a container, driven from THIS supervisor session. The supervisor generates the kickoff, drives the container worker via the CLI, reports progress here, and pushes a branch for you to test + merge. One IDE, no Git Bash, no copy-paste, no second window."
license: MIT
author: video-editor
version: 3.0.0
user_invocable: true
---

# /dotask

Turn a planned task into finished, pushed work — driven entirely from this one chat.

## Model (decided with the user)

- **Supervisor** = THIS VS Code Claude session. The user chats here (GUI, image paste, their
  Claude subscription). You drive everything via tools and REPORT results back here.
- **Worker** = a permission-free CLI Claude (`claude -p`) running INSIDE a per-task Docker
  container (`scripts/task.sh`). It does the actual edits/commits with no permission prompts,
  on the user's subscription (the container CLI inherits it via the seeded ~/.claude — verified;
  no API key, no extra billing). The user never opens a second IDE, a terminal, or Git Bash.
- **Handoff** = when the work is done + tests pass, you PUSH the task's branch to GitHub so the
  user fetches it, tests it themselves, and merges. The container is a SEPARATE clone, so its
  branch only reaches the user's repo via this push.

## When to Apply
- User says `/dotask <id>` (a `T####` from `docs/plans/PLAN.md`, possibly in an epic subfolder).

## Procedure (supervisor runs all of this via tools)

1. **Resolve** `docs/plans/tasks/**/T<id>-*.md`. If 0/many match, list + ask. `SLUG = t<id lowercased>`.

2. **Read context:** the task file in full + `CLAUDE.md` (+ `EPIC.md` if referenced). Verify any
   prerequisite/"Follows:" task is merged. Skim the named "Relevant Files" so the kickoff is concrete.

3. **Generate a READY-TO-USE kickoff** (kickoff template in [task-management/SKILL.md](../task-management/SKILL.md)):
   the EXPANDED prompt the worker acts on directly. Fill every value (no placeholders): Stage-0
   classification, agent table, applied/skipped stages, task-specific steps, key rules. Start with
   `Implement T<id>: <title>`. Tell the worker to: follow the standard workflow; if it's design-gated,
   STOP at the architecture gate; **commit with EXPLICIT `git add <paths>` only — never `-A`/`-a`**
   (the container clone shows mass CRLF noise; a broad add would commit thousands of junk lines);
   and NOT change task statuses. Write it to `C:\tmp\kickoff-<SLUG>.md` (Write tool).

4. **Pre-flight Docker:** `docker info`. If down, tell the user to start Docker Desktop and stop.

5. **Start the container + seed the kickoff** (via Bash):
   ```
   bash scripts/task.sh up <SLUG>
   docker exec -i -u dev reel-task-<SLUG> bash -c 'cat > /workspace/.dotask-kickoff.md' < /c/tmp/kickoff-<SLUG>.md
   ```
   First `up` builds the image + installs deps (a few min); later runs are fast.

6. **Drive the worker** with headless CLI calls, reporting each result back here. Run long calls
   with `run_in_background: true`:
   ```
   docker exec -u dev reel-task-<SLUG> bash -lc 'cd /workspace && claude -p "<instruction>"'
   ```
   - First call: "Read /workspace/.dotask-kickoff.md and execute it. If design-gated, stop at the
     approval gate and summarize the design + open questions."
   - Continue the SAME worker session across stages with `claude -p -c "<next instruction>"`
     (e.g. after the user approves: "Design approved (Q1-3 as proposed). Proceed to implement + run
     the tests; commit explicit paths; report the diffstat and test results.").
   - **Relay gates to the user**: surface the design/decisions here, get the answer, pass it down.

7. **Verify + push for the user to test:** once the worker reports implementation done and tests
   green, sanity-check the diffstat, then:
   ```
   bash scripts/task.sh push <SLUG>
   ```
   Tell the user: in GitHub Desktop, **Fetch origin -> switch to `feature/T<id>-…` -> test it ->
   PR/merge**. (They do the final merge; you never merge their branch without approval.)

8. **Cleanup is automatic.** A committed `post-merge` hook (`.githooks/post-merge`, enabled via
   `git config core.hooksPath .githooks`) deletes the remote branch + nukes the container when the
   branch lands on master — whether merged in GitHub Desktop or CLI. Don't ask the user to clean up.
   Only step in if the hook's log (`/c/tmp/post-merge-cleanup.log`) shows the container nuke was
   skipped (GitHub Desktop's PATH lacks docker) — then run `bash scripts/task.sh nuke <SLUG>`.

## Notes
- **Read/inspect the worker's files directly:** the container bind-mounts to `C:\work\tasks\<SLUG>\…`
  on the host — open any file there without git.
- **Test the app on the branch:** `bash scripts/task.sh stack <SLUG>` -> `http://localhost:<offset>`,
  or `bash scripts/task.sh test <SLUG>` for headless Playwright E2E (both run in the container).
- **GUI worker (optional):** if the user explicitly wants to chat with the worker themselves with
  image paste, `bash scripts/task.sh code <SLUG>` attaches a VS Code window — but that window's
  EXTENSION needs its own sign-in (separate credential store from the CLI). The default supervisor-
  driven CLI path above avoids that entirely.
- **Teardown:** `bash scripts/task.sh down <SLUG>` (keep checkout) or `nuke <SLUG>` (delete it).
