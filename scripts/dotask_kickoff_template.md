# Kickoff: group __SLUG__

Branch: `__BRANCH__` (ONE branch, ONE PR for this whole group). Wave: `__WAVE_ID__`.
Work the tasks below IN ORDER, sequentially, ONE COMMIT PER TASK. Each commit subject
starts with that task's id (`T1234: ...`); acceptance criteria are namespaced `T1234:C1`.

## Tasks

__TASK_LIST__

## Rules (all tasks, all phases)

- Read `CLAUDE.md`, then the knowledge doc(s) named by each task file, BEFORE exploring.
  Docs are claims, code is truth.
- For EACH task: branch state already matches the group branch (don't create a new branch
  per task). Failing test first (observe it fail for the intended reason), implement, run the
  named relevant tests + explicit lint, commit with EXPLICIT `git add <paths>` (never
  `-A`/`-a`), subject `T<id>: <summary>`, ending `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Append one status line to `/workspace/.dotask-status` after every stage, format
  `<UTC yyyy-mm-ddTHH:MM> STAGE_DONE <task> <stage> "<detail>"`. Never end a dispatch silently.
- **Red/green proof for the landing gate** (required): before production code changes, run the
  new test against the unchanged code and save the raw output to `qa/red-<test>.log`; after the
  fix save `qa/green-<test>.log`. At the end of the LAST task, write `qa/proof.json`:
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
  Every path is relative to the checkout root; `scripts/dotask_evidence.py` re-hashes any
  artifact that recorded a `sha256` and refuses to build evidence if the test file changed
  since red/green.
- Test scope: the RELEVANT SET only (~10 tests: new tests + regression tests for the files you
  change + at most one e2e spec). Never a full suite. Name the set in the status line.
- Do NOT spawn a reviewer: `/dotask land` captures the authoritative review, and only with
  `--capture` (this group's capture flag: __CAPTURE__). If your first focused fix attempt
  fails on a non-obvious mechanism, spawn the `expert` agent (Opus) with the knowledge doc
  name and a precise question -- one escalation, not a third guess. Escalate to `expert` for:
  root-causing a bug whose mechanism isn't obvious, an architecture/design tradeoff, async or
  persistence/concurrency issues, or performance analysis beyond an obvious hot spot. Use
  `code-expert` first for an unknown entry point or stale knowledge doc.
- Persistence: gesture-based only; no `useEffect` that writes to a store/backend. No silent
  fallbacks for internal data.
- Headless run: execute every command in the foreground (a backgrounded command or
  ScheduleWakeup ends this dispatch). Append each status line in the same shell command as the
  stage's last action, not as a separate call.
- Never `git push` / `gh pr create` -- you have no push creds by design.
- Stage 7 (last task only): update the touched knowledge doc(s) if you learned a new invariant.

## When every task is PUSHREADY

Tell the user: **run `bash scripts/dotask.sh land __SLUG__` (or `/dotask land __SLUG__`)** from
their own chat. Do not attempt to push, open a PR, or land yourself.
