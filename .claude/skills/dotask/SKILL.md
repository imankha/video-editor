---
name: dotask
description: "Kick off planned tasks in permission-free container workers, driven from THIS supervisor session. WIP limit 4 (all pairs file-disjoint, quota fresh): bank each branch as it lands rather than letting all 4 pile up unreviewed. The supervisor maintains the WAVE.md manifest + per-task status files (stateless supervision — a fresh session bootstraps from files, never from conversation history), spawns workers via spawn-worker, relays gates, and pushes branches for you to test + merge."
license: MIT
metadata:
  author: video-editor
  version: 5.0.0
user-invocable: true
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
  ~/.claude; no API key). Hook scripts travel with the clone; ignored local hook settings must be reconstructed by bootstrap. Hook silence is not proof of a check.
- **Landing** = when work is done + tests pass, you PUSH each task branch and wait for Branch
  CI. Merge automatically only when the proof-based landing rule in step 6 is satisfied;
  otherwise hand the branch to the user for the missing human verdict.

## When to Apply
- User says `/dotask <id>` or `/dotask <id> <id> ...` (T#### from `docs/plans/PLAN.md`).
- Multiple ids = a QUEUE, not necessarily one flat wave: WIP limit is 4 workers, all pairs
  file-disjoint AND the session quota fresh. Tasks beyond 4, or that conflict on files, wait
  in WAVE.md and start as slots free up (a slot frees when a branch has its CI verdict and is landed or handed to
  the user).
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

   **Canonical expert-selection matrix:** classify the task's primary domain before spawning
   agents. Always record the selected expert(s), record the reason and evidence for the selection, and any
   deliberately skipped specialist in the kickoff and `WAVE.md`; **Do not spawn every expert.**
   Select one primary expert for the dominant uncertainty, then add only specialists whose
   output is required by the acceptance criteria:

   | Signal or changed domain | Primary specialist | Add when the task also requires |
   |---|---|---|
   | Unknown entry point, stale knowledge, or a knowledge gap in cross-domain data flow | `code-expert` | A concrete unresolved mechanism after one focused read |
   | Non-obvious bug, architecture tradeoff, async, persistence, concurrency, performance, or one failed fix | `expert` | Never for purely mechanical edits |
   | `backend-services.md`, API, Postgres/SQLite, or schema/persisted format | `expert` | `migration` for schema/format changes |
   | `persistence-sync.md`, R2 sync, versioning, restore, or deletion | `expert` | `migration` if stored schema changes; `reviewer` for every M/L task |
   | `modal-gpu.md` or `export-pipeline.md`, FFmpeg, Modal, GPU, or export durability | `expert` | `reviewer` and the relevant knowledge document |
   | `annotate.md` or `keyframes-framing.md`, timeline, clips, keyframes, or crop behavior | `code-expert` | `ui-designer` for an under-specified UI; `expert` for timing/state/performance uncertainty |
   | UI behavior with missing interaction or visual decisions | `ui-designer` | `ux-investigator` only when behavioral/funnel evidence is needed |
   | Funnel drop-off, analytics, or suspected user confusion | `ux-investigator` | `ui-designer` after the evidence-backed design decision |
   | Explicitly scoped behavior-preserving prerequisite refactor | `refactor` | `expert` only if the refactor exposes a non-obvious design tradeoff |

   `architect` is required for every L-tier or explicitly design-gated task. `tester` is
   included when separate test authorship adds value and by default for L-tier work.
   `implementor` executes the approved specification. `reviewer` is required for M/L,
   `proof-verifier` is required before every automatic landing, and `merge-reviewer` is
   required when the user asks whether a branch is ready to merge. Never substitute a
   general-purpose worker for a named specialist, and never treat a specialist's prose as
   proof of expertise without the relevant tests or evidence.

3. **Queue plan (multi-task only).** Before spawning anything, build a file-ownership map:
   the primary files each task touches (from task files + knowledge docs). RULES:
   - **WIP limit: 4 concurrent workers.** Every pair in the wave must share no primary files
     AND the session quota must be fresh. Beyond 4, or on any file conflict, queue in WAVE.md
     instead of spawning. Landing coordination is serial regardless of worker count; human testing is conditional on proof gaps — a
     full 4-wide wave means up to 4 branches queued on the user's review at once, so bank
     (push + CI verdict + hand to user) each branch as it lands rather than letting all 4 sit
     unreviewed.
   - Two tasks sharing a primary file never overlap — merge them into ONE worker
     (one container, sequential commits) or queue one behind the other.
   - Tasks inside a strict-serial epic (e.g. export-write-path, keyframe-unification) never
     overlap.
   - Release a slot only after landing or a complete user handoff with CI evidence. A dependent, strict-serial, or same-file successor must wait for its predecessor to MERGE and start from the integrated base; pushing alone does not satisfy the dependency.
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
   commands and triage paths). A red verdict must be triaged — fix, attribute to
   known-failures.md, or task it — before proceeding.

   Apply `CLAUDE.md` Landing Policy; this is the single authority for the proof bar.
   Use the supervisor gate documented in [landing-gate-usage.md](../../../docs/plans/landing-gate-usage.md).
   Run its `capture` commands for reviewer and proof-verifier from the clean approved
   controller checkout. Keep evidence and signed receipts outside the worker checkout.
   A worker-supplied verdict or a prose-only review does not replace captured receipts.
   - Dispatch `subagent_type: proof-verifier` in a fresh context with criteria, base/head
     SHAs, unchanged proof-test contents/hash, commands, and raw evidence paths. Require
     an independent verdict; worker self-attestation and code approval are insufficient.
   - MORE_PROOF_REQUIRED: return the exact missing evidence to implementor/tester and
     repeat verification. For post-hoc tests reproduce pre-fix failure and final success
     in isolated checkouts, never by reverting shared source files.
   - VERIFIED plus resolved code findings and green required CI for the final head:
     create the PR, then run `python scripts/landing_gate.py check` and `land` with the
     external evidence/store and candidate checkout arguments from the usage guide.
     The gate re-fetches CI/head/base and applies the exact-head merge precondition.
     Do not bypass a blocked verdict with a direct merge command.
     Set PLAN.md/task status to STAGING only after merge and report the evidence.
   - HUMAN_VERIFICATION_REQUIRED or unresolved proof: keep the branch open; continue
     feasible evidence work, otherwise hand off exact gaps/steps and set WAITING ON USER
     only when the user's input is needed. Docs/refactors do not silently waive the bar.

   Start the next queued task once this one is landed or handed off. Cleanup is automatic on
   merge (post-merge hook); see spawn-worker for the fallback. On merge, delete the task's
   WAVE.md row.

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
