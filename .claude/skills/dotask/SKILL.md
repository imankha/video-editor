---
name: dotask
description: "Kick off planned tasks in permission-free container workers, driven from THIS supervisor session. WIP limit 1 (max 2 disjoint): finish and bank a branch before starting the next. The supervisor maintains the WAVE.md manifest + per-task status files (stateless supervision — a fresh session bootstraps from files, never from conversation history), spawns workers via spawn-worker, relays gates, and pushes branches for you to test + merge."
license: MIT
author: video-editor
version: 5.0.0
user_invocable: true
---

# /dotask

Turn planned task(s) into finished, pushed work — driven entirely from this one chat.

**Progress = merges banked, not work in flight.** The 2026-08-06 burn analysis measured the
3-wide-wave pattern: three workers ran 5-10h in parallel on one subscription, all stalled at
~90% when the session limit hit, zero branches merged, ~3M output tokens burned in a day.
Every rule below that caps concurrency, session length, or test scope exists to convert that
burn into merges.

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
- Multiple ids = a QUEUE, not a parallel wave: WIP limit is 1 worker (2 only when files are
  fully disjoint AND the session quota is fresh). Remaining tasks wait in WAVE.md and start
  as slots free up (a slot frees when a branch is PUSHED and handed to the user).
- **Container gate (tier check first):** containers pay for themselves on L-tier work and on
  genuinely parallel disjoint tasks. For an S or M single-area task, propose doing it INLINE
  in this session instead (shared tree, commit early, explicit `git add`) — the container's
  fixed cost (build + clone + kickoff + fresh-context ramp) exceeds the task. The user's
  /dotask call wins if they still want the container.

## Procedure (supervisor)

1. **Resolve** each `docs/plans/tasks/**/T<id>-*.md`. If 0/many match, list + ask.
   `SLUG = t<id lowercased>`.

2. **Read context per task:** task file in full + `CLAUDE.md` (+ `EPIC.md` if referenced) +
   the task's `.claude/knowledge/` domain doc(s). Verify any prerequisite/"Follows:" task is
   merged. Run Stage-0 classification (tier!) per task.

3. **Queue plan (multi-task only).** Before spawning anything, build a file-ownership map:
   the primary files each task touches (from task files + knowledge docs). RULES:
   - **WIP limit: 1 concurrent worker.** 2 ONLY when the two tasks share no primary files AND
     the session quota is fresh. Never 3+. Parallel workers on one subscription don't add
     throughput — they make every task stall at the session limit simultaneously, and the
     user's test+merge gate is serial anyway.
   - Two tasks sharing a primary file never overlap — merge them into ONE worker
     (one container, sequential commits) or queue one behind the other.
   - Tasks inside a strict-serial epic (e.g. export-write-path, keyframe-unification) never
     overlap.
   - A queued task starts only after the previous branch is PUSHED with its CI verdict
     reported — bank before you start the next.
   Present the queue plan (who runs now, who's queued, who's merged into one worker) in one
   short table, then proceed — don't wait for approval unless a conflict forces a judgment
   call.

3.5. **Write the manifest — `C:/work/tasks/WAVE.md`** (create or update; this is the source
   of truth for what's in flight, NOT this conversation). One row per non-banked task:
   ```
   | slug  | branch                         | container       | tier | stage | next gate   | updated          |
   | t5215 | feature/T5215-intro-attachment | reel-task-t5215 | L    | qa    | user test   | 2026-08-06T19:12 |
   | t6630 | (queued)                       | -               | M    | queued| spawn       | 2026-08-06T14:00 |
   ```
   Update the row at every spawn, gate, push, and hand-to-user. Delete the row when the
   branch is merged (post-merge cleanup). Paired with each worker's status file
   (`C:/work/tasks/<SLUG>/.dotask-status`, see spawn-worker), this makes supervision
   STATELESS: any fresh session reconstructs the whole picture from
   `WAVE.md` + `docker ps --filter name=reel-task` + tailing the status files (~2k tokens).

4. **Generate a READY-TO-USE kickoff per worker** (template in
   [task-management/SKILL.md](../task-management/SKILL.md)): the EXPANDED prompt the worker
   acts on directly — no placeholders. Include: tier + Stage-0 classification, agent table,
   applied/skipped stages, the knowledge doc path(s) to load FIRST, task-specific steps, key
   rules (explicit `git add`, no status changes, design-gate stop, update knowledge docs at
   Stage 7), AND the mandatory QA phase (spawn-worker step 4): live-drive the feature via
   dev-verify.sh, write the tests the task needs, run the RELEVANT SET only (~10 tests for
   the corner of the code being changed — never a full suite), evidence mapped to EVERY
   acceptance criterion, AND the status-file contract (append a line to
   `/workspace/.dotask-status` after every stage; final act is always `PUSHREADY` or
   `BLOCKED`). Write to `C:\tmp\kickoff-<SLUG>.md`.

5. **Spawn worker(s):** apply [spawn-worker](../spawn-worker/SKILL.md) per the queue plan
   (WIP limit above). Run container `up` steps SEQUENTIALLY (port-offset allocation races
   when parallel — see spawn-worker), drive with `run_in_background: true`. Track progress by
   READING `C:/work/tasks/<SLUG>/.dotask-status` (bind-mounted — no `docker exec`, no
   full-context probe turns); relay design gates to the user as they appear in the status
   file or the background call's completion.

6. **Land:** per worker, sanity-check diffstat -> `bash scripts/task.sh push <SLUG>` ->
   **fetch and report the Branch CI verdict** (see spawn-worker step 5 for the exact poll
   commands and triage paths) -> update the WAVE.md row (`stage: pushed`, `next gate: user
   test`) -> tell the user which branch is ready -> start the next queued task. A red verdict
   must be triaged — fix, attribute to known-failures.md, or task it — before the user is
   told to test. Cleanup is automatic on merge (post-merge hook); see spawn-worker for the
   fallback. On merge, delete the task's WAVE.md row.

## Session lifetime (supervisor)

- **The supervisor session ends when the queue is drained** (every task PUSHED + reported, or
  parked as BLOCKED in WAVE.md). Never carry a supervisor conversation across days — a
  250-400k-context session pays its whole history on every turn (one measured 4-day session:
  1,458 turns, 376M cache-read tokens).
- **Everything a future session needs lives in files**, updated as it happens: WAVE.md,
  per-task `.dotask-status`, PLAN.md statuses. If it's only in this conversation, it's lost
  state — write it down NOW, not at session end.
- **Cold-start bootstrap** (fresh session, cleared conversation, post-quota-reset — same
  procedure): read `C:/work/tasks/WAVE.md`; run `docker ps --filter name=reel-task`; tail
  each listed `C:/work/tasks/<SLUG>/.dotask-status`. That triple tells you every in-flight
  task, its container's liveness, and its last completed stage. Resume driving from there —
  do NOT re-read old supervisor transcripts or re-derive the wave from PLAN.md.
