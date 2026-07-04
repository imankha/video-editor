---
name: dotask
description: "Kick off one or more planned tasks in permission-free container workers, driven from THIS supervisor session. The supervisor plans the wave (file-ownership check), spawns a worker per task via spawn-worker, relays gates, and pushes branches for you to test + merge. One IDE, no second window."
license: MIT
author: video-editor
version: 4.0.0
user_invocable: true
---

# /dotask

Turn planned task(s) into finished, pushed work — driven entirely from this one chat.

## Model (decided with the user)

- **Supervisor** = THIS VS Code Claude session. The user chats here; you drive everything via
  tools and REPORT results back here. /dotask is the USER's command; spinning up containers is
  YOUR move — the [spawn-worker](../spawn-worker/SKILL.md) subroutine, invoked once per task.
- **Worker** = a permission-free CLI Claude (`claude -p`) inside a per-task Docker container
  (`scripts/task.sh`). Separate clone, no permission prompts, user's subscription (seeded
  ~/.claude; no API key). Lint hooks travel with the clone and run inside the container.
- **Handoff** = when work is done + tests pass, you PUSH each task branch to GitHub; the user
  fetches, tests, merges. You never merge without approval.

## When to Apply
- User says `/dotask <id>` or `/dotask <id> <id> ...` (T#### from `docs/plans/PLAN.md`).
- Multiple ids = a WAVE: workers run in parallel, one container each.

## Procedure (supervisor)

1. **Resolve** each `docs/plans/tasks/**/T<id>-*.md`. If 0/many match, list + ask.
   `SLUG = t<id lowercased>`.

2. **Read context per task:** task file in full + `CLAUDE.md` (+ `EPIC.md` if referenced) +
   the task's `.claude/knowledge/` domain doc(s). Verify any prerequisite/"Follows:" task is
   merged. Run Stage-0 classification (tier!) per task.

3. **Wave plan (multi-task only).** Before spawning anything, build a file-ownership map:
   the primary files each task touches (from task files + knowledge docs). RULES:
   - Two tasks sharing a primary file do NOT run in parallel — merge them into ONE worker
     (one container, sequential commits) or defer one to the next wave.
   - Tasks inside a strict-serial epic (e.g. export-write-path, keyframe-unification) never
     run in the same wave.
   - Cap: 3-5 concurrent workers (supervision quality drops beyond that).
   Present the wave plan (who runs, who's merged, who's deferred) in one short table, then
   proceed — don't wait for approval unless a conflict forces a judgment call.

4. **Generate a READY-TO-USE kickoff per worker** (template in
   [task-management/SKILL.md](../task-management/SKILL.md)): the EXPANDED prompt the worker
   acts on directly — no placeholders. Include: tier + Stage-0 classification, agent table,
   applied/skipped stages, the knowledge doc path(s) to load FIRST, task-specific steps, key
   rules (explicit `git add`, no status changes, design-gate stop, update knowledge docs at
   Stage 7). Write to `C:\tmp\kickoff-<SLUG>.md`.

5. **Spawn workers:** apply [spawn-worker](../spawn-worker/SKILL.md) once per task. Drive all
   workers concurrently with `run_in_background: true`; report each worker's progress here as
   notifications arrive. Relay any design gates to the user.

6. **Land:** per worker, sanity-check diffstat -> `bash scripts/task.sh push <SLUG>` -> tell
   the user which branches are ready. Cleanup is automatic on merge (post-merge hook); see
   spawn-worker for the fallback.
