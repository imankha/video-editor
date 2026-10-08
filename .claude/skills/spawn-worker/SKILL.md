---
name: spawn-worker
description: "Worker-side contract for a /dotask container: status-line protocol, phases, qa/proof.json schema, and headless rules. Not a user command and not run by a supervisor -- scripts/dotask_cli.py's kickoff template carries these rules into the container directly, and the user's own Claude session there follows them."
license: MIT
user-invocable: false
metadata:
  author: video-editor
  version: 3.0.0
---

# spawn-worker (worker-side contract)

There is no supervisor session driving this anymore (2026-10-08). `scripts/dotask_cli.py`'s
`start` command brings up the container, writes the kickoff at
`/workspace/.dotask-kickoff.md` (rendered from `scripts/dotask_kickoff_template.md`, which
embeds this contract's essentials directly), and either opens a VS Code window attached to it
(the user talks to that Claude session) or runs it headless via `task.sh run`. This document
is the reference for what that worker session (interactive or headless) must do; it is not
something a human or model "spawns" per task anymore.

## Status-line contract

Append ONE line to `/workspace/.dotask-status` after every stage -- the checkout is
bind-mounted, so `scripts/dotask_cli.py status` and the user both read it with a plain file
read. Format:
```
2026-08-06T14:31 STAGE_DONE T1 impl 4f2c91a
2026-08-06T16:02 STAGE_DONE T1 tests "9 relevant tests green: 6 feature + 3 regression"
2026-08-06T16:40 STAGE_DONE T2 qa "evidence per criterion in qa/"
2026-08-06T17:40 BLOCKED "design gate: two card-layout options, need user pick"
2026-08-06T19:12 PUSHREADY feature/T1-T2-fix-things 7d10b3e
2026-09-11T08:05 AUTH_DEAD probe failed: Not logged in - Please run /login
2026-10-08T10:12 DISPATCH_FAILED phase=implementation exit=1 outcome=budget_stop
```
- One group = one branch; work each task sequentially, one commit per task (`T1: ...`,
  `T2: ...`). The FINAL act across the whole group is `PUSHREADY <branch> <sha>` (commit done,
  QA evidence complete) or `BLOCKED <reason>`. Never end a dispatch silently.
- **Wrapper lines** (written by `task.sh run`/`drive`'s profiler, not the worker, only when the
  worker left no new line): `DISPATCH_FAILED phase= exit= outcome=` (`budget_stop`,
  `quota_exhausted`, `auth_failed`, `error`, or `interrupted`), `ENDED_WITHOUT_STATUS phase=`
  (exit 0 but no line), `PHASE_VIOLATION` (a design dispatch changed files outside `docs/`).
- **`AUTH_DEAD`** is written automatically by `task.sh drive`/`run`, not the worker: it means
  the read-only auth status probe failed even after re-seeding from the host's credentials.

## Phases (headless only; an interactive session just works the kickoff top to bottom)

`task.sh run <slug> "<instruction>"` dispatches implementation, then -- only if the last status
line is `IMPL_READY` -- immediately chains QA with `-c` (no turn in between). Interactive
sessions don't need this chaining; just follow the kickoff and append status lines per stage.
- **Implementation**: branch state already matches the group's branch (one branch per group,
  not per task). For each task: failing test first (observe it fail for the intended reason),
  implement, run the named relevant tests + explicit lint, commit. `IMPL_READY` ends the phase.
- **QA (mandatory, never push without it)**: live-drive the feature
  (`bash scripts/dev-verify.sh e2e/<spec>`), write the full test matrix (happy path + named edge
  cases + a regression test), map every acceptance criterion to evidence, then write
  `qa/proof.json` (schema below). `PUSHREADY <branch> <sha>` or `BLOCKED <reason>` ends it.
- Test scope is the RELEVANT SET only (~10 tests: new + regression tests for changed files + at
  most one e2e spec). Never a full suite -- Branch CI is the full sweep.

## `qa/proof.json` schema

Written once, at the end of the LAST task (searched at `qa/proof.json` or
`src/frontend/qa/proof.json` by `scripts/dotask_evidence.py`, which `dotask.sh land` calls):
```json
{
  "task_ids": ["T1", "T2"],
  "criteria": [{"id": "T1:C1", "description": "...", "artifacts": ["test1", "red1", "green1"]}],
  "artifacts": {
    "test1": {"path": "qa/test_x.py", "sha256": "<hex, from sha256sum when you ran red/green>"},
    "red1": {"path": "qa/red-test_x.log"},
    "green1": {"path": "qa/green-test_x.log"}
  },
  "tests": [{"criteria": ["T1:C1"], "test": "test1", "red_log": "red1", "green_log": "green1",
             "red_exit": 1, "green_exit": 0, "red_reason": "AssertionError: ..."}],
  "human_checks": []
}
```
Paths are relative to the checkout root. Criteria ids are namespaced `T<id>:C<n>` (required for
a multi-task group; harmless for a single task). `dotask_evidence.py` re-hashes any artifact
that recorded a `sha256` and refuses to build evidence if the test file changed since
red/green -- the hash must be the test file's ACTUAL hash when you ran red/green, not a
placeholder.

## Rules that apply to every phase

- Read `CLAUDE.md`, then the knowledge doc(s) the kickoff names, BEFORE exploring. Docs are
  claims, code is truth.
- Commit with EXPLICIT `git add <paths>` only, never `-A`/`-a`; subject starts with the task
  id, ends `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Do NOT spawn a reviewer. `/dotask land` captures the authoritative review, and only with
  `--capture`. Escalate to the `expert` agent (Opus) for a non-obvious root cause, an
  architecture/design tradeoff, async/persistence/concurrency issues, or performance analysis
  beyond an obvious hot spot -- one escalation, not a third guess. Use `code-expert` first for
  an unknown entry point or a stale knowledge doc.
- Persistence: gesture-based only; no `useEffect` that writes to a store/backend; no silent
  fallbacks for internal data.
- Headless run: execute every command in the foreground (a backgrounded command or
  ScheduleWakeup ends the dispatch). Append each status line in the same shell command as the
  stage's last action, not as a separate call.
- **NEVER `git push` / `gh pr create`.** No push creds by design; `task.sh` hard-aborts a push
  from inside the container. Commit, then stop and report -- `/dotask land` pushes and opens
  the PR from the host.
- Do NOT change PLAN.md task statuses (the group's tasks were already flipped to WIP at
  `start`; `land` does not touch PLAN.md either -- STAGING is set only after merge, by the user
  or `--capture`'s gate).
- Update the touched `.claude/knowledge/` doc(s) before the final `PUSHREADY` if you learned a
  new invariant or landmine.
