---
name: dotask
description: "Kick off one or more planned tasks as a GROUP in a permission-free container: one container + one checkout + one branch + one PR for the whole group, tasks worked sequentially. There is no model supervisor -- this chat runs scripts/dotask.sh and relays its few output lines, then returns immediately; the user talks to the worker directly in a new VS Code window (or headless with --headless)."
license: MIT
metadata:
  author: video-editor
  version: 6.0.0
user-invocable: true
---

# /dotask

Turn one or more planned tasks into one pushed branch + one PR, worked in a container the user
talks to directly. **This chat is not a supervisor.** It runs `scripts/dotask.sh`, relays the
few lines it prints, and does not monitor or poll the container afterward.

## Why no supervisor

The 2026-08-06 burn analysis measured the old 3-worker supervised pattern: ~90% progress, zero
branches merged, ~3M output tokens burned in a day, mostly on supervisor bookkeeping and
polling. A later measurement (wave 2026-10-08-a) found the supervisor's own turns outweighed
every worker's usage combined. Removing the supervisor removes that cost entirely: the user
drives the worker's Claude session directly, and this chat's only job is the three commands
below.

## What `/dotask` does

| User says | This chat runs | Then |
|---|---|---|
| `/dotask T1 T2 ...` | `bash scripts/dotask.sh start T1 T2 ...` | Relay the 3-line summary (slug, branch, window). Return. Say nothing else. |
| `/dotask T1 T2 ... --headless` | `bash scripts/dotask.sh start --headless T1 T2 ...` | Relay slug/branch/log path. Return. |
| `/dotask T1 T2 ... --allow-overlap` | `bash scripts/dotask.sh start --allow-overlap T1 T2 ...` | Same as a normal start, but files shared with another live group are a warning, not a refusal; the kickoff tells the worker to rebase on master before PUSHREADY. |
| `/dotask T1 T2 ... --capture` | `bash scripts/dotask.sh start --capture T1 T2 ...` | Same, plus: this group's `land` will run captured review/proof automatically. |
| `/dotask land <slug>` | `bash scripts/dotask.sh land <slug>` | Step 1 of 2. Restarts the group's app stack and returns only once the frontend + backend `/api/health` answer. Relay the URL (`http://localhost:<5173+offset>`) and STOP: the human tests the app. Nothing is pushed and no PR exists yet. Records the tested HEAD. On a timeout it exits non-zero with the log paths; relay them. |
| `/dotask land <slug> --after-test` | `bash scripts/dotask.sh land <slug> --after-test` | Step 2, only after the user says the test passed. Refuses if HEAD moved since step 1 (re-run step 1). Pushes, opens the PR, waits for CI, builds evidence, marks committed tasks completed in the wave profile. Relay PR URL, CI verdict, evidence dir, profile path (and gate result if `--capture`). |
| `/dotask stack <slug>` | `bash scripts/dotask.sh stack <slug>` | Same stack (re)start + wait as land step 1, without recording a tested HEAD. Relay the URL. |
| `/dotask status` | `bash scripts/dotask.sh status` | Relay the one line per live group. |

That is the entire contract. This chat never writes WAVE.md, never spawns a worker agent,
never drives a design/implementation/QA loop, and never watches a status file after `start`
returns. `dotask.sh` makes no model calls itself (see its own docstring for exactly what it
does: preflight, git/gh plumbing, container lifecycle via `task.sh`).

## The group model (user decisions, 2026-10-08 -- do not re-ask)

- **One `/dotask T1 T2 ...` = ONE container + ONE checkout + ONE branch + ONE PR** for the
  whole group. Tasks are worked sequentially inside that one container, one commit per task
  (`T1: ...`, `T2: ...`), criteria namespaced per task (`T1:C1`, `T2:C1`, ...).
- **One task per conversation** (user decision, 2026-10-08). After each task's commit the worker
  stops and asks the user to send `/clear`, then `Implement /workspace/.dotask-kickoff.md`.
  The fresh conversation resumes at the first task without a `STAGE_DONE <task> commit` line,
  and `qa/proof.json` grows one task at a time. Measured on g-t12110-8: one session across 8 tasks
  re-read 48k -> 190k tokens per request. Fresh context per task is an estimated 33-51% fewer
  worker input tokens. Headless runs one `task.sh run` (a fresh `claude -p`) per task.
- **The work happens in a NEW VS Code window attached to that container**
  (`task.sh code <slug> --prompt-file <kickoff>`, run by `dotask.sh start`). The user talks to
  that Claude session directly -- it IS the worker, running on Sonnet (every task container's
  settings default to the `sonnet` alias; see `.devcontainer/task-bootstrap.sh`). This chat
  does not relay turns to or from it.
- **Parallelism = the user runs `/dotask` again** -- another group, another container, another
  window. There is no WIP-limit bookkeeping to maintain here; each group is independent.
- **`--headless`** runs the group through `task.sh run` (implementation -> QA, chained, no
  supervisor turn) in the background instead of opening a window; `dotask.sh start` prints the
  log path and returns immediately without waiting for it.
- **Captured review/proof only with `--capture`.** Without it, `/dotask land` pushes, opens the
  PR, waits for CI, builds the evidence directory (`scripts/dotask_evidence.py`, reading the
  worker's `qa/proof.json`), and hands the PR + evidence path to the user -- nothing merges
  automatically. With `--capture` (set at `start` time, carried in the group's
  `.dotask-group.json`), `land` additionally runs the captured reviewer + proof-verifier +
  `landing_gate.py check`/`land` from the controller checkout and reports the gate result. This
  is consistent with CLAUDE.md's Landing Policy -- automatic landing still requires captured
  receipts; the default simply stops short of it and leaves that call with the user.

## Preflight (what `start` refuses, and why)

`dotask.sh start` refuses before touching Docker if: a task id doesn't resolve to exactly one
`docs/plans/tasks/**/T<id>-*.md` file; a task's PLAN.md status isn't `TODO`/`WIP`; a task
already has a commit on `origin/master` matching `^T<id>[: ]`; or any task's Relevant Files
overlap the owned files of another group whose container is currently running. Each refusal
exits 2 with a clear reason -- relay it to the user, don't retry automatically. Files shared
WITHIN one group are fine (its tasks run sequentially). For an overlap with another live group,
the refusal names each task and file and prints the command for the clear tasks; the user may
instead re-run with `--allow-overlap`, which starts the group and has the worker rebase on
master before PUSHREADY so a conflict surfaces in its own container, not in the PR.

## Landing

`/dotask land <slug>` is host-side bookkeeping only (container/git/gh/evidence plumbing), run
from THIS chat once the user says the group is done (or a `PUSHREADY` line appears in its status
file, if the user asks this chat to check). It never edits code and never calls a model unless
`--capture` was set. It has two steps so a human always tests the running app before a PR
exists: `land <slug>` brings the stack up and stops, and `land <slug> --after-test` opens the
PR for the exact HEAD that was tested. The stack restarts on every call, so it serves the
current working tree; ports stay inside the R2 CORS allowlist because `task.sh` caps the
offset at 10. Apply CLAUDE.md's Landing Policy as the single authority for the proof
bar: automatic merge requires resolved blocking/major findings, independently VERIFIED proof,
and green required CI for the same final revision -- `landing_gate.py` enforces this inside
`land --capture`. Without `--capture`, the PR + evidence handoff to the user is the terminal
state; this chat does not chase a merge itself.

## Status tracking

There is no WAVE.md and no supervisor session to bootstrap. `bash scripts/dotask.sh status`
lists every live group (slug, tasks, container state, last status line) by reading
`.dotask-group.json` + `.dotask-status` files directly -- that IS the full picture, every time,
from any fresh chat. Nothing here needs to survive in conversation history.
