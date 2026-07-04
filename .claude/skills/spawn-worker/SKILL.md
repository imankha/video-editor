---
name: spawn-worker
description: "Supervisor-side subroutine: spin up ONE permission-free container worker for a task and drive it to a pushed branch. Not a user command — /dotask (or any supervisor flow the user approved) invokes this once per task. Multiple workers run in parallel."
license: MIT
author: video-editor
version: 1.0.0
user_invocable: false
---

# spawn-worker (supervisor subroutine)

Lifecycle for ONE task container. The caller (usually /dotask) has already resolved the task,
generated the kickoff, and checked file-ownership against other live workers. `SLUG = t<id>`.

## Inputs
- `SLUG`, kickoff file at `C:\tmp\kickoff-<SLUG>.md` (see kickoff template in
  [task-management/SKILL.md](../task-management/SKILL.md); it must name the task's
  `.claude/knowledge/` doc(s) so the worker loads them instead of re-exploring)

## Lifecycle

1. **Pre-flight Docker** (once per wave, not per worker): `docker info`. If down, tell the
   user to start Docker Desktop and stop.

2. **Start + seed:**
   ```
   bash scripts/task.sh up <SLUG>
   docker exec -i -u dev reel-task-<SLUG> bash -c 'cat > /workspace/.dotask-kickoff.md' < /c/tmp/kickoff-<SLUG>.md
   ```
   First `up` builds the image (a few min); later runs are fast.

3. **Drive** with headless CLI calls; ALWAYS `run_in_background: true` so other workers and
   the supervisor keep moving:
   ```
   docker exec -u dev reel-task-<SLUG> bash -lc 'cd /workspace && claude -p "<instruction>"'
   ```
   - First call: "Read /workspace/.dotask-kickoff.md and execute it. If design-gated, stop at
     the approval gate and summarize the design + open questions."
   - Continue the SAME worker session across stages with `claude -p -c "<next instruction>"`.
   - **Relay gates to the user**: surface design/decisions in the supervisor chat, get the
     answer, pass it down with `-c`.
   - The clone carries `.claude/settings.json`, so the eslint/ruff PostToolUse hook runs
     inside the container too — the worker gets lint feedback automatically.

4. **Verify:** worker self-verifies in the live app from inside the container:
   `bash scripts/dev-verify.sh e2e/<spec>` (see [drive-app-as-user](../drive-app-as-user/SKILL.md)).
   Fallback if the worker is blocked: supervisor runs `bash scripts/task.sh test <SLUG>`.

5. **Push for the user to test:** once implementation done + tests green + knowledge doc(s)
   updated (Stage 7), sanity-check the diffstat, then:
   ```
   bash scripts/task.sh push <SLUG>
   ```
   Report: fetch origin -> switch to `feature/T<id>-…` -> test -> merge.

6. **Cleanup is automatic** via the committed `post-merge` hook (`.githooks/post-merge`)
   when the branch lands on master. Only step in if `/c/tmp/post-merge-cleanup.log` shows the
   container nuke was skipped — then `bash scripts/task.sh nuke <SLUG>`.

## Worker rules (bake into every kickoff)
- Follow the standard workflow at the task's TIER (CLAUDE.md § Task Tiers); stop at the
  architecture gate if design-gated.
- Commit with EXPLICIT `git add <paths>` only — never `-A`/`-a`.
- Do NOT change task statuses.
- Update the task's `.claude/knowledge/` doc(s) before declaring done (Stage 7).
- `/workspace/CLAUDE.local.md` already carries container facts (python path, test commands,
  DATABASE_URL, log fallback) — don't repeat them.

## Handy
- Inspect worker files without git: bind-mount at `C:\work\tasks\<SLUG>\…`
- Run the app on the branch: `bash scripts/task.sh stack <SLUG>` -> `http://localhost:<offset>`
- GUI worker (image paste): `bash scripts/task.sh code <SLUG>` (extension needs its own sign-in)
- Teardown: `bash scripts/task.sh down <SLUG>` (keep checkout) / `nuke <SLUG>` (delete)
