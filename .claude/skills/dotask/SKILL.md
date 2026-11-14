---
name: dotask
description: "Kick off one or more planned tasks as a GROUP in a permission-free container: one container + one checkout + one branch + one PR for the whole group, tasks worked sequentially. There is no model supervisor -- this chat runs scripts/dotask.sh and relays its few output lines, then returns immediately; the group runs headless by default, one fresh conversation per task (or in a new VS Code window with --window)."
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
| `/dotask T1 T2 ...` | `bash scripts/dotask.sh start T1 T2 ...` | Headless (the default). Relay slug/branch/log path and the `eta:` line. Return. Say nothing else. At most 4 tasks per group (`--allow-large` overrides; see [the group model](#the-group-model-user-decisions-2026-10-08----do-not-re-ask)). |
| `/dotask T1 T2 ... --window` | `bash scripts/dotask.sh start --window T1 T2 ...` | Relay the 3-line summary (slug, branch, window). Return. |
| `/dotask T1 T2 ... --allow-overlap` | `bash scripts/dotask.sh start --allow-overlap T1 T2 ...` | Same as a normal start, but files shared with another live group are a warning, not a refusal; the kickoff tells the worker to rebase on master before PUSHREADY. |
| `/dotask T1 T2 ... --capture` | `bash scripts/dotask.sh start --capture T1 T2 ...` | Same, plus: this group's `land` will run captured review/proof automatically. |
| `/dotask autoland <slug>` | `bash scripts/dotask.sh autoland <slug>` | Runs the [verify loop](#automatic-landing-headless-default) by hand: a `--window` group, or a headless run that stopped. `--no-land` stops after a clean verdict. Relay the last status line. |
| `/dotask resume <slug>` | `bash scripts/dotask.sh resume <slug>` | Continue a headless group that stopped (a BLOCKED question answered, a CONFLICT ruled, a crash, a reboot): the build loop for every task without a commit line, then autoland, which itself resumes a fix round's focused re-check. The first headless launch runs this same command. Stop a loop still running for the group first. Relay the `eta:` line. |
| `/dotask approve <slug>` | `bash scripts/dotask.sh approve <slug>` | The owner tested a `READY_TO_TEST` stack and it works: push that exact HEAD, open the PR, wait for CI (red CI goes to a fix round and back to a test). Relay the PR URL. |
| `/dotask land <slug>` | `bash scripts/dotask.sh land <slug>` | Step 1 of 2. First runs `scripts/dotask_preland_check.sh` on the checkout (whitespace, non-evidence files under `qa/`, ruff/eslint growth, `ci_policy` routing) and refuses, naming the paths, while it fails. Then restarts the group's app stack and returns only once the frontend + backend `/api/health` answer. Relay the URL (`http://localhost:<5173+offset>`) WITH a test guide (see [Test guide](#test-guide-required-with-every-localhost-link)) and STOP: the human tests the app. Nothing is pushed and no PR exists yet. Records the tested HEAD. On a timeout it exits non-zero with the log paths; relay them. |
| `/dotask land <slug> --after-test` | `bash scripts/dotask.sh land <slug> --after-test` | Step 2, only after the user says the test passed. Refuses if HEAD moved since step 1 (re-run step 1). Pushes, opens the PR, waits for CI, builds evidence scoped to the group's tasks (another group's `qa/proof.json` entries never block it), marks committed tasks completed in the wave profile. Relay PR URL, CI verdict, evidence dir, profile path (and gate result if `--capture`). |
| `/dotask stack <slug>` | `bash scripts/dotask.sh stack <slug>` | Same stack (re)start + wait as land step 1, without recording a tested HEAD. Relay the URL with a test guide. |
| `/dotask status` | `bash scripts/dotask.sh status` | Relay the one line per live group and its `eta:` line; say when the ETA changed (see [Status tracking](#status-tracking)). A group whose PR merged has its container and app stack stopped here (`freed:`; checkout kept, `task.sh nuke` clears it); `start` does the same before its overlap check (owner rule 2026-11-08: free merged groups on merge). |
| `/nextup` | see the [nextup skill](../nextup/SKILL.md) | Bundles TODO tasks by shared code area (`dotask.sh nextup`), confirms with the user, then runs `start`. |

That is the entire contract. This chat never writes WAVE.md, never spawns a worker agent,
never drives a design/implementation/QA loop, and never watches a status file after `start`
returns. `dotask.sh` makes no model calls itself (see its own docstring for exactly what it
does: preflight, git/gh plumbing, container lifecycle via `task.sh`).

## The group model (user decisions, 2026-10-08 -- do not re-ask)

- **One `/dotask T1 T2 ...` = ONE container + ONE checkout + ONE branch + ONE PR** for the
  whole group. Tasks are worked sequentially inside that one container, one commit per task
  (`T1: ...`, `T2: ...`), criteria namespaced per task (`T1:C1`, `T2:C1`, ...).
- **One task per conversation** (user decision, 2026-10-08). After each task's commit the worker
  stops. Headless (the default, user decision 2026-11-06), the loop then starts a fresh `claude -p`
  with the Implement instruction, which is `/clear` + resend with no human in it. With `--window`
  the worker asks the user to send `/clear`, then `Implement /workspace/.dotask-kickoff.md`.
  The fresh conversation resumes at the first task without a `STAGE_DONE <task> commit` line,
  and `qa/proof.json` grows one task at a time. Measured on g-t12110-8: one session across 8 tasks
  re-read 48k -> 190k tokens per request. Fresh context per task is an estimated 33-51% fewer
  worker input tokens. Headless runs one `task.sh drive` (a fresh `claude -p`) per task.
- **Shared notes carry learning across the clears** (user decision, 2026-10-09). Each fresh
  conversation reads `/workspace/.dotask-notes.md` first and appends a `## T<id>` section after
  its commit: what later tasks need about the code they share (API as used, wiring, conventions,
  test patterns, traps, decisions). Gitignored; `land --after-test` archives it to
  `waves/<wave_id>/notes.md`. This pays off most when the group's tasks touch the same code,
  which is what `/nextup` (`dotask.sh nextup`) bundles for.
- **The work happens in a NEW VS Code window attached to that container**
  (`task.sh code <slug> --prompt-file <kickoff>`, run by `dotask.sh start`). The user talks to
  that Claude session directly -- it IS the worker, running on Opus (owner rule 2026-11-13: every
  task container's settings default to the `opus` alias, see `.devcontainer/task-bootstrap.sh`; headless
  dispatches run `opus` at effort `medium` in every phase, `DOTASK_MODEL`/`DOTASK_EFFORT` override). This chat
  does not relay turns to or from it.
  Once the container has the Claude extension (about a minute on a first attach), `task.sh code`
  opens `vscode://anthropic.claude-code/open?prompt=...`, which prefills the kickoff line in the
  panel; the user presses Enter (the URI never submits). VS Code routes it to the last active
  window, so focusing another window during that minute sends the prefill there instead.
  `DOTASK_PREFILL=0` turns it off.
- **At most 4 tasks per group** (user decision, 2026-11-07). One PR carries the whole group, so one
  failing task holds back every passing one at landing: g-t15220-10's export bug held eight. `start`
  refuses a fifth task (`--allow-large` overrides) and `nextup` prints one `start:` line per four.
  Landing the passing tasks of a group separately would need per-task branches; not built.
- **Parallelism = the user runs `/dotask` again** -- another group, another container, another
  window. There is no WIP-limit bookkeeping to maintain here; each group is independent.
- **Headless is the default** (`--headless` is still accepted): the group runs in the background,
  one fresh `task.sh drive` dispatch per task, stopping on `PUSHREADY` or anything unexpected.
  `dotask.sh start` prints the log path and returns immediately without waiting for it.
  `--window` opens the VS Code window instead, for a group you want to talk to.
- **Captured review/proof only with `--capture`.** Without it, `/dotask land <slug> --after-test`
  (after the human test) pushes, opens the PR, waits for CI, builds the evidence directory (`scripts/dotask_evidence.py`, reading the
  worker's `qa/proof.json`), and hands the PR + evidence path to the user -- nothing merges
  automatically. With `--capture` (set at `start` time, carried in the group's
  `.dotask-group.json`), `land` additionally runs the captured reviewer + proof-verifier +
  `landing_gate.py check`/`land` from the controller checkout and reports the gate result. This
  is consistent with CLAUDE.md's Landing Policy -- automatic landing still requires captured
  receipts; the default simply stops short of it and leaves that call with the user.

## Preflight (what `start` refuses, and why)

`dotask.sh start` refuses before touching Docker if: a task id doesn't resolve to exactly one
`docs/plans/tasks/**/T<id>-*.md` file; a task's PLAN.md status isn't `TODO`/`WIP`; a task
already has a commit on `origin/master` matching `^T<id>[: ]`; a task's file still waits on a
user ruling (a decision page, "the user picks", "owner has ruled") with no recorded ruling
(`## Ruling` with `(owner, <date>)`, `user picked ...`, `USER PICK`; an unchecked criterion
never counts) -- a headless worker has nobody to ask, so ask the user, record the ruling in the
task file, commit, then start; or any task's Relevant Files
overlap the owned files of another group whose container is currently running. Each refusal
exits 2 with a clear reason -- relay it to the user, don't retry automatically. Files shared
WITHIN one group are fine (its tasks run sequentially). For an overlap with another live group,
the refusal names each task and file and prints the command for the clear tasks; the user may
instead re-run with `--allow-overlap`, which starts the group and has the worker rebase on
master before PUSHREADY so a conflict surfaces in its own container, not in the PR.

`start` also warns (never refuses) about an acceptance criterion that names a task outside the group
which has not landed (status not STAGING/DONE), with the live group running it if any: its verifier may
not be able to prove that criterion until the other task merges (T14960:C4 needed T14930 on g-t15280-3,
2026-11-08). Relay the warning; the user can add the task to the group, wait, or re-scope the criterion.

## Test guide (required with every localhost link)

A bare URL is not a handoff (user feedback, 2026-10-09: on T12100 the user had to ask what
changed and where to find it). Whenever `land` step 1 or `stack` returns a URL, read each
group task's file (Problem, Solution, Acceptance Criteria) and relay, per task:

- **Where:** the exact screen and the clicks to reach it, plus any data the check needs
  (e.g. "a game with at least one clip", "a Finished highlight you haven't opened").
- **What to look for:** each visible change, as expected behavior vs. the old behavior.
- **Edge cases:** empty states, mobile width, etc., when the criteria call them out.

Keep it a short numbered list per task. This is the one place this chat reads task files;
it still never edits code or drives the worker.

## Automatic landing (headless default)

User decision, 2026-11-07: a headless group lands itself. After `PUSHREADY`, `autoland` loops:

**Worker-written checks** (owner decision 2026-11-09). One fresh verifier per criterion still passed the
15-minute cap on 9 of 12 criteria on g-t15340-1, mostly rebuilding Playwright setup the worker already had.
So the worker commits one check per acceptance criterion with its task (kickoff, "Checks" rule):
`src/frontend/e2e/checks/T<id>.checks.json` names each criterion's kind: `browser` (a test titled with the id
in `T<id>.check.spec.js`, logged in through `loginForCheck` from `e2e/helpers/checkAuth.js` so the same file
runs on the dev stack and on staging), `code` (one command: a grep or one targeted test file), or `human`.

1. Preland check, then restart the stack on HEAD and load the signed-in app once (`warm_stack`), so Vite's
   first compile is not paid inside the verify budget.
2. The harness runs every check itself, no agent (`run_checks`): `code` commands in the container, each
   task's browser checks in one Playwright run through `scripts/dev-verify.sh`. A failed or missing check is
   a `fail` whatever anyone says. Then ONE reviewer dispatch (`qa` phase, no shared context with the worker)
   reads each check against its criterion's text and fails a weak one: it asserts less than the text, mocks
   the behavior under test, sets up through a back door state the criterion says a user creates (g-t15340-1's
   cold-load test POSTed the resume point the app writes itself, and passed on broken code), or would pass on
   broken code. There is no separate regression pass: Branch CI and the staging check cover that. The merged
   verdict is `.dotask-verify.json`; each round is archived as `waves/<wave>/verify-round-N.json`.
3. Any `fail` criterion or `group` bug goes to a fix round: one fresh worker dispatch per owning task,
   in group order, each fixing and committing only its task's findings (findings no task owns go last).
   A task whose dispatch commits nothing is recorded (`FIX_SKIPPED`), its leftover changes stashed, and
   the round moves on; its findings fail again in the re-check. One worker given every finding chased
   the hardest one and committed nothing for three hours (g-t15220-10, 2026-11-07). A fix dispatch that
   runs out of turns is restarted up to twice with a handoff note (below). A missing or weak check comes back
   as a finding, and the fix worker writes or strengthens it. Then back to step 1, where only what failed or
   was skipped is run and reviewed again; earlier passes carry forward (`carried_from`). A restarted
   `autoland` resumes at that point.
   A fix worker that believes a finding is wrong (a flake, not this branch's, a misread criterion) ends on
   `DISPUTED <label> <finding>: <evidence>` instead of working around it. The dispute is not a stop: the
   next reviewer gets the fixer's evidence and re-examines the finding fresh (one that also fails on
   origin/master becomes an `unrelated` bug). Only a finding that reviewer still upholds stops the loop,
   with `VERIFY_NEEDS_USER` naming both sides (g-t14940-1, 2026-11-08, needed the owner for a flake).
4. Clean verdict: `VERIFY_PASS`, then **the owner tests before any PR** (owner rule 2026-11-13). The loop
   brings the group's stack up on that HEAD, writes `profiles/<slug>/test-guide.md` (each task's criteria
   and how each was checked: browser, code, nobody yet, or not verified), and stops at
   `READY_TO_TEST <head>: test <url> with <guide>, then /dotask approve <slug>`. Relay the URL with a
   [test guide](#test-guide-required-with-every-localhost-link) built from that file and the task files. The
   owner says it works: `bash scripts/dotask.sh approve <slug>` (refuses if HEAD moved) pushes that HEAD, opens
   the PR, waits for CI, builds evidence, `LANDED`. The owner says something is wrong: write it into the task
   file's notes or a criterion, then `/dotask resume <slug>`. `DOTASK_OWNER_TEST=0` restores the old
   push-on-clean-verdict flow. Merging stays with the user.
   Red Branch CI after approval is a finding too: `CI_RED`, and the failed jobs and the tail of their logs
   become a `group` bug for a fix round, then the re-check and a new `READY_TO_TEST` for the new HEAD (PRs #720,
   #722, #723 waited on a person for this, 2026-11-08). It counts against `MAX_FIX_ROUNDS`.

**One verify budget per group: 30 minutes** (owner rule 2026-11-09; `DOTASK_VERIFY_BUDGET_MIN` overrides),
shared by every round's stack start, checks and review (`verify_spent_s` in the group file, so a restart keeps
it). The reviewer gets what is left, at most 15 minutes. When the budget is spent, nothing more is checked:
what is left is recorded `skipped` (`VERIFY_SKIPPED` status line), never a pass or a fail, and the PR opens
listing it under "Not verified". A reviewer past its time or out of turns lands its passing checks the same way.
A reviewer that left edits in the tree still stops the loop (`VERIFY_BLOCKED`).

The loop stops at `MAX_FIX_ROUNDS` (3) with `VERIFY_EXHAUSTED`. Anything it cannot trust stops it with
`VERIFY_BLOCKED` and never counts as a pass: a missing verdict, a verdict for another HEAD, a reviewer
that changed the tree, a fix that committed nothing. A criterion the verdict leaves out (fewer criteria than
the task file has) is not a stop: it lands as `skipped`, listed as not verified, never as a pass (g-t16030-1,
2026-11-10: stopping there hid a real failure).
What the reviewer's own tooling rewrites (`package-lock.json` from `npm install`, files under `qa/` from a
landing build) is put back with `git checkout` and is not "changed the tree"; any other edit still is.

One driver per group: `resume` and `autoland` hold `.dotask-run.lock` (the process id) for the whole run,
and a second launch for the same group is refused while that process lives; a lock whose process is gone
is taken over. Two autolands once raced on one checkout after a launch that looked dead was relaunched.
`task.sh drive` retries a failed `claude auth status` up to 3 times (20 s apart, re-seeding credentials
each time) before `AUTH_DEAD`; every AUTH_DEAD seen so far cleared on a plain resume.
A `human` criterion (something no automation can observe) never stops the push: staging is the real gate,
so it rides in the PR body under "Check on staging after merge" (`staging_checks` on the group).
`unrelated` bugs are filed as TODO tasks in PLAN.md and do not block. The filing is committed at
once to master in the main checkout (the task file and its PLAN row only, not pushed), so no one else takes
the id; if PLAN.md already held someone's uncommitted edit, it is left uncommitted with a warning. "No
new bugs" means none found by these checks.

**The staging check after merge is the real gate** (owner decision 2026-11-09). When `status` or `start`
sees a group's PR merged, it starts `python scripts/dotask_cli.py staging-check <slug>` detached
(`STAGING_CHECK_STARTED`; log in `profiles/<slug>/staging-check.log`). That waits for the staging deploy of
the merge commit (`deploy-frontend.yml` and `deploy-backend.yml`; a commit touching neither app deploys
nothing and is checked anyway), runs every task's browser checks against staging inside the group's
container (`E2E_BASE_URL`, `E2E_API_BASE`, seeded account `E2E_CHECK_EMAIL`, default `e2e-gate@test.local`;
`DOTASK_STAGING_URL`, `DOTASK_STAGING_API` and `DOTASK_STAGING_EMAIL` override), files each failure as a bug task at once ("Filed by /dotask
staging check"), appends `STAGING_CHECK PR #n: k of m browser checks passed`, and frees the container. A
failed or timed-out deploy stops it with `STAGING_CHECK_BLOCKED` and keeps the container for a re-run.
`code` checks are not repeated: CI ran them. A group with no browser checks is freed at once.

**Running out of turns is not a stop.** A worker dispatch (build or fix round) whose run record says
`budget_stop` left its work uncommitted; the loop appends a `## <task> handoff` section to
`.dotask-notes.md` (the uncommitted files, a pointer to the worker's `## <task> progress` checklist),
writes a `RESUMED` status line and dispatches again with the resume hint, up to twice per task. Three
such stops were restarted by hand on g-t15220-10 (2026-11-07), one after an overnight gap.

**A conflict between tasks stops the build, not the verifier.** The kickoff tells a worker that re-reads
the other tasks' criteria before committing and finds its change makes one literally false to append
`CONFLICT <task> <other>:C<n> "<why>"` and stop without committing. The build loop stops there; the
user rules (fix the change, or amend the criterion), then `/dotask resume <slug>`.

## Landing

`/dotask land <slug>` is host-side bookkeeping only (container/git/gh/evidence plumbing), run
from THIS chat once the user says the group is done (or a `PUSHREADY` line appears in its status
file, if the user asks this chat to check). It never edits code and never calls a model unless
`--capture` was set. Used by hand (a `--window` group, or a human test you want), it has two steps so a human tests the
running app before a PR exists: `land <slug>` brings the stack up and stops, and `land <slug> --after-test` opens the
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

**ETAs are standard (user decision, 2026-11-07).** Every `status` line is followed by an `eta:` line:
when the PR should open if nothing fails, when it should open with one fix round, and the basis (tasks
left, verify batches, CI, and whether the minutes are this group's own medians or defaults). `start`
prints one too. Relay it with every status or start, with the user's local clock. **When an ETA
changes, say so**: if an earlier relay in this conversation gave a different ETA (more than 15 minutes
apart), name the old and new figure and what moved (the basis says: a slower batch, a fix round, a
stop). A stopped group has `eta: none (stopped ...)`: relay the reason and what unblocks it (`resume`,
a ruling). The run log gets the same treatment: the loop prints `[dotask] eta: ...` at each milestone
only when the figure moved, with `(was HH:MM)`.
