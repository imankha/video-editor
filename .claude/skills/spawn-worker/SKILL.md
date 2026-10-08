---
name: spawn-worker
description: "Supervisor-side subroutine: spin up ONE permission-free container worker for a task and drive it to a pushed branch via the status-file contract (no polling turns). Not a user command — /dotask (or any supervisor flow the user approved) invokes this per task, respecting the WIP limit of 4 (all pairs file-disjoint, quota fresh)."
license: MIT
user-invocable: false
metadata:
  author: video-editor
  version: 2.0.0
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
   **`up` calls must run SEQUENTIALLY across workers** — `alloc_offset` in task.sh scans
   ports then persists the offset to `<checkout>/.task-env` without a lock, so parallel
   `up`s grab the same offset and the losers fail with "port is already allocated".
   Recovery from a poisoned worker: `docker rm -f reel-task-<SLUG>`, delete
   `C:\work\tasks\<SLUG>\.task-env`, re-run `up`. Only the step-3 drive calls parallelize.
   After seeding, initialize the status file and the WAVE.md row (see /dotask step 3.5):
   ```
   echo "$(date -u +%FT%H:%M) SPAWNED <tier> <branch>" >> /c/work/tasks/<SLUG>/.dotask-status
   ```
   **Also set the task's PLAN.md status to WIP at this exact moment** — flip the status column
   in `docs/plans/PLAN.md` and the `**Status:**` line in the task's own file from TODO to WIP,
   in the SUPERVISOR's checkout (not the worker's clone). This is the AI-owned factual status
   transition from CLAUDE.md's Task Status Rule ("WIP — work begins or resumes... a task must
   never sit at WIP while AI is idle") — a spawned worker actively driving the task IS that
   transition, so it must never be skipped or deferred to task-complete time. Don't wait for a
   batch of tasks to fill WAVE.md's queue before doing this — set it per-task, at spawn, one at
   a time (batching status edits across multiple tasks in one commit is exactly how T6990 drifted
   out of sync in 2026-08-15 — see `project_planmd_status_drift_batched_commits` memory).
   A task that stays QUEUED in WAVE.md (not yet spawned, waiting on a file-conflict or dependency
   to clear) stays TODO in PLAN.md — WIP is set only once the container is actually driving it.

2.5. **Status-file contract (the completion protocol — replaces polling).** The worker
   appends ONE line to `/workspace/.dotask-status` after every stage; the checkout is
   bind-mounted, so the supervisor reads it at `C:\work\tasks\<SLUG>\.dotask-status` with a
   plain file read — never a `docker exec` probe, never a full-context "are you done?" turn.
   Line format (worker MUST be told this in the kickoff; each stage's definition of done
   includes writing its line):
   ```
   2026-08-06T14:31 STAGE_DONE impl 4f2c91a
   2026-08-06T16:02 STAGE_DONE tests "9 relevant tests green: 6 feature + 3 regression"
   2026-08-06T16:40 STAGE_DONE qa "evidence per criterion in qa/"
   2026-08-06T17:40 BLOCKED "design gate: two card-layout options, need user pick"
   2026-08-06T19:12 PUSHREADY feature/T5215-intro-attachment 7d10b3e
   2026-09-11T08:05 AUTH_DEAD probe failed: Not logged in - Please run /login
   2026-10-08T10:12 DISPATCH_FAILED phase=implementation exit=1 outcome=budget_stop
   ```
   - Each phase ends with its own line: design `DESIGN_READY`, implementation `IMPL_READY`,
     QA `PUSHREADY <branch> <sha>` (commit done, QA evidence complete, ready for the supervisor
     to `task.sh push`); any phase may end `BLOCKED <reason>`. A worker is never "quietly finished".
   - **Wrapper lines** (written by `task.sh drive`'s profiler, not the worker, only when the
     worker left no new line): `DISPATCH_FAILED phase= exit= outcome=` (`outcome` is
     `budget_stop`, `quota_exhausted`, `auth_failed`, `error` or `interrupted`),
     `ENDED_WITHOUT_STATUS phase=` (exit 0 but no line: the worker ended its turn early),
     `PHASE_VIOLATION` (a design dispatch changed files outside `docs/`; review before reuse).
   - **Liveness rule:** exit-0 silence is meaningless (finished / quota-dead / auth-dead look
     identical). The status file disambiguates: `DESIGN_READY`/`IMPL_READY` = phase complete;
     `PUSHREADY`/`BLOCKED` = done; `DISPATCH_FAILED`/`ENDED_WITHOUT_STATUS` = resume per the
     outcome (quota: wait for reset, then fresh-seed; budget_stop: re-scope or fresh-seed; error:
     read the dispatch's printed result first). Only a drive call that was killed mid-run leaves
     no line at all; resume it (step 3 resume rules), don't forensically re-read transcripts.
   - **`AUTH_DEAD`** is written automatically by `task.sh drive` (step 3), not by the worker. `claude auth status`
     only proves credentials are present; an expired/revoked token surfaces instead as
     `DISPATCH_FAILED ... outcome=auth_failed` from the dispatch itself (no tokens spent). `AUTH_DEAD`
     it means the read-only auth status failed EVEN AFTER re-seeding the container from the
     host's credentials, so the host login itself is likely stale. This should be rare (the
     per-dispatch re-seed in step 3 closes the concurrent-refresh race that used to cause this
     silently — see `project_dotask_quota_hit_corrupts_container_credentials` memory); if it
     fires, check the host CLI is actually logged in (`claude auth status --text` on the host) before
     retrying the dispatch, rather than assuming it's this container's problem.

3. **Drive** with headless CLI calls via `task.sh run` (the default — NOT raw
   `docker exec ... claude -p`): it re-seeds this container's credentials from the host, runs
   read-only auth status from a safe cwd before every call (closing the concurrent-refresh
   auth-corruption race documented in `project_dotask_quota_hit_corrupts_container_credentials`;
   a failed probe writes `AUTH_DEAD` to the status file and exits non-zero instead of dispatching
   into a dead container), dispatches the implementation phase, and — ONLY if the last status
   line is `IMPL_READY` — immediately chains the QA dispatch with `-c` (cache still warm, no
   supervisor turn in between). ALWAYS `run_in_background: true` so other workers and the
   supervisor keep moving:
   ```
   bash scripts/task.sh run <SLUG> "<instruction>"
   ```
   `task.sh drive` (single-phase, manual) is still the tool for a design-only dispatch
   (`DOTASK_PHASE=design`), a mid-phase resume, or re-running a stuck QA phase on its own:
   ```
   bash scripts/task.sh drive <SLUG> "<instruction>"
   ```
   **Dispatch policy:** the wrapper owns every Claude flag. Only `-c`, `--resume <id>` and the
   instruction text pass through; any other flag is rejected. Set environment variables before
   `bash scripts/task.sh drive` (never MODEL_FLAGS); always set `DOTASK_WAVE_ID`, or the run is
   reported as `standalone-<slug>` and excluded from the wave profile. `DOTASK_TASK_IDS`
   (comma-separated) overrides the slug for batch workers.
   `DOTASK_WAVE_ID=<wave> DOTASK_PHASE=implementation DOTASK_MODEL=sonnet DOTASK_EFFORT=medium`
   is the default for every tier. S mechanical work may use low effort. Design or unresolved
   root-cause work alone uses `DOTASK_PHASE=design DOTASK_MODEL=opus DOTASK_DESIGN_REASON=<reason>`.
   Opus stops at DESIGN_READY/BLOCKED with a reusable specification under `docs/`; the wrapper
   fails the dispatch with `PHASE_VIOLATION` if a design run changed any other path. Nested Opus
   is limited to the `expert`/`architect` agents; any other Opus use is listed in the profile's
   `policy_violations`. Implementation stops at IMPL_READY. The supervisor separately dispatches
   `DOTASK_PHASE=qa DOTASK_MODEL=sonnet DOTASK_EFFORT=medium` to collect final evidence.
   Use `DOTASK_MAX_TURNS` to adjust the enforced default of 120 turns with a recorded reason.
   A budget stop checkpoints and resumes intentionally; it is not a successful completion.
   The wrapper records usage in bind-mounted `.dotask-profile/` and copies it to
   `C:\work\tasks\profiles\<SLUG>\` after every dispatch and before `nuke`; host step timings
   (container wake, auth, dispatch, push, e2e) go to `meta.jsonl` there.
   - First call: "Read /workspace/.dotask-kickoff.md and execute only the assigned phase. Append a status line to
     /workspace/.dotask-status after every stage. If design-gated, stop at the approval gate,
     write a BLOCKED line, and summarize the design + open questions."
   - **Resume rules (`-c` vs fresh — the re-context tax is real):** `-c` re-uses the session
     but after the prompt cache expires (~1h idle) it RE-WRITES the entire conversation as
     cache-creation tokens (~the full context, 100-400k). So: continue with
     `bash scripts/task.sh drive <SLUG> -c "<next instruction>"` only when the last worker
     activity was recent (status-file timestamp < ~1h old). Otherwise send a FRESH dispatch
     seeded from files: `bash scripts/task.sh drive <SLUG> "Read /workspace/.dotask-kickoff.md
     and /workspace/.dotask-status. Branch <branch> has commits through <sha>. Continue from
     the last STAGE_DONE line."` (~5k tokens vs ~400k.) `-c` is per-container-safe (own
     ~/.claude volume); pre-fix shared-volume containers always get the fresh-seed form.
   - **Worker enforced dispatch budget defaults to 120 turns:** a worker grinding past its budget without PUSHREADY is a
     signal (mis-tiered task, stuck loop), not normal. Stop it, read the status file, and
     either re-scope or resume fresh from the checkpoint — don't let it run to quota death.
   - Workers share the user's subscription quota. Cache-expiry thresholds below are operational heuristics, not guaranteed provider behavior. On "session limit" output: write the time
     down, wait for the reset, then resume via the fresh-seed form (the cache is dead by then
     — never `-c` across a quota gap).
   - **Relay gates to the user**: a BLOCKED status line surfaces the question in the
     supervisor chat; get the answer, pass it down (recent cache: `-c`; else fresh-seed).
   - Bootstrap recreates the hooks configuration when absent (`.claude/settings.json` is gitignored). The hook is best-effort feedback; verify lint explicitly rather than interpreting silence as success.

4. **QA phase (MANDATORY — never push without applicable verification):** implementation done is not task done. Documentation/tooling-only work uses direct consistency or tool checks; live application/E2E checks below apply when user flows change.
   The worker must close the feedback loop with evidence, not claims:
   - **Drive the feature live**: exercise the changed flow end-to-end in the running app as a
     real user (`bash scripts/dev-verify.sh e2e/<spec>` — see
     [drive-app-as-user](../drive-app-as-user/SKILL.md)). For UI changes, assert on what the
     user actually SEES (rendered text/state), not just API responses.
   - **Write ALL meaningful tests**, not one smoke test: happy path, each edge case the task
     names, each failure mode touched, and a regression test pinning the original bug. If a
     case can't be tested, the report must say which and why — silence is not allowed.
   - **Test-RUN scope is the RELEVANT SET — ~10 tests, curated, never everything** (writing
     broad, running narrow). Procedure: first understand the CORNER of the code the change
     lives in (the changed files + what directly consumes them, from the knowledge doc), then
     NAME the set before running it — typically the tests written for this feature plus the
     existing regression tests guarding that corner, plus the one e2e spec for the changed
     flow. Discover candidates from imports and existing coverage, curate, then execute named test files. More complexity = a bigger relevant
     set, chosen deliberately; NEVER a full suite, never a whole layer's tests, never "run
     everything to be safe" — the Branch CI verdict in step 5 IS the full sweep, and Master
     CI re-runs it on merge. The status line names the set: `STAGE_DONE tests "9 relevant:
     6 feature + 2 corner regressions + 1 e2e"`. Fix loop: re-run the failing test + tests
     exercising the files the fix touched, nothing more
     (`.claude/skills/run-tests/SKILL.md` § Scope policy).
   - **Adversarial self-check**: re-read the task's acceptance criteria one by one and show
     evidence per criterion (test name or live-drive observation). Unverified criterion =
     task not done.
   - **Evidence artifacts, not prose**: use `src/frontend/e2e/helpers/qa.js` —
     `saveEvidence(page, 'criterion-N-...')` screenshots each criterion's end state into
     `<repo>/qa/` (gitignored; readable from the host at `C:\work\tasks\<SLUG>\qa\`).
   - **Write `qa/proof.json`** (or `src/frontend/qa/proof.json`) at the end of the QA phase —
     the supervisor's `scripts/dotask_evidence.py` reads it to build the landing-gate
     `evidence.json` without a capture session re-deriving everything from prose. Schema:
     ```json
     {
       "task_ids": ["T1234"],
       "criteria": [{"id": "T1234:C1", "description": "...", "artifacts": ["test1", "red1", "green1"]}],
       "artifacts": {
         "test1": {"path": "qa/test_x.py", "sha256": "<hex, from sha256sum when you ran red/green>"},
         "red1": {"path": "qa/red-test_x.log"},
         "green1": {"path": "qa/green-test_x.log"}
       },
       "tests": [{"criteria": ["T1234:C1"], "test": "test1", "red_log": "red1", "green_log": "green1",
                  "red_exit": 1, "green_exit": 0, "red_reason": "AssertionError: ..."}],
       "human_checks": []
     }
     ```
     Criteria ids are namespaced `T<id>:C<n>` (required for batches, harmless for a single
     task). Every path is relative to the checkout root. `dotask_evidence.py` re-hashes any
     artifact that recorded a `sha256` and refuses to build evidence if the test file changed
     since red/green — so the hash must be the ACTUAL `test1` file's hash at the time you ran
     the red/green proof, not a placeholder.
   - **Responsive check (any UI change)**: `responsiveSweep(page)` runs the changed screen at
     375px + desktop, asserts no horizontal overflow, and saves both screenshots. The
     screen-usability audit runs for the CHANGED screen(s) only
     (`npx playwright test screen-usability.spec.js --grep "<screen>"`), not the full
     5-viewport matrix over every screen.
   - **Perf guards (when queries/endpoints changed)**: backend — use the `query_counter`
     pytest fixture (seed N rows, assert statement count stays flat; see
     tests/test_query_counter.py); frontend — assert a sane timing budget in the e2e spec
     (e.g. changed screen interactive < 3s on the local stack).
   - **Pre-existing failures**: use docs/testing/known-failures.md as a lead, then substantiate the same failure on the unchanged baseline. Without current evidence, report attribution as unverified; never call a failing run green.
   QA is the single largest token sink in a task (live-driving Playwright, screenshots, full
   test matrix) and is almost entirely spec-following — the acceptance criteria are the spec.
   **Run it on Sonnet at `medium` effort regardless of tier.** After IMPL_READY the supervisor always sends a separate QA dispatch:
   `DOTASK_PHASE=qa DOTASK_MODEL=sonnet DOTASK_EFFORT=medium bash scripts/task.sh drive <SLUG> -c "QA phase per kickoff: drive the changed feature live,
   complete the test matrix, map every acceptance criterion to evidence. Report the evidence."`
   Apply the resume-age rule above; stale sessions start fresh with the DOTASK_* dispatch variables and file-based context. Fallback if the worker is blocked: supervisor runs `bash scripts/task.sh test <SLUG>`.

5. **Push, then merge if provably verified (else hand off for user test):** once
   implementation done + QA evidence per criterion + tests green + knowledge doc(s) updated
   (Stage 7), sanity-check the diffstat, then:
   ```
   bash scripts/task.sh push <SLUG>
   ```
   **Mandatory CI-verdict step (do NOT skip):** after the push, fetch the Branch CI result
   before reporting the branch ready:
   ```
   # Resolve the pushed task branch SHA in its own checkout, not the supervisor HEAD.
   # Supply that value as EXPECTED_HEAD; never select merely the latest branch run.
   EXPECTED_HEAD=<pushed-task-head-sha>
   for i in 1 2 3 4 5; do
     RESULT=$(gh run list --workflow "Branch CI" --branch <branch> \
               --limit 20 --json databaseId,headSha,status,conclusion | \
               jq --arg sha "$EXPECTED_HEAD" '[.[] | select(.headSha == $sha)]')
     [ "$(echo "$RESULT" | jq 'length')" -gt 0 ] && break
     sleep 10
   done
   RUN_ID=$(echo "$RESULT" | jq -r --arg sha "$EXPECTED_HEAD" '[.[] | select(.headSha == $sha)][0].databaseId // empty')
   # Missing run is unverified. Stop this procedure; do not fall back to another SHA.
   [ -n "$RUN_ID" ] || { echo "No CI run for expected head"; exit 1; }
   gh run watch "$RUN_ID" --exit-status
   gh run view "$RUN_ID" --json headSha,status,conclusion,jobs
   # Inspect required job outcomes, including unexpected skips. Failure/cancel/timeout
   # is not green. If the branch moves, start again for its new head.
   ```
   - **GREEN**: report the exact run/head and proceed to independent proof verification; a user test is conditional on the remaining proof gaps.
   - **RED**: DO NOT tell the user to test yet. Triage in the supervisor chat:
     1. **Fix in the worker** (via `bash scripts/task.sh drive <SLUG> <instruction>`) if it is a real regression introduced by this task, with `DOTASK_PHASE=implementation` and the resume-age rules above.
     2. **Attribute to known-failures.md** (`docs/testing/known-failures.md`) if it is a
        pre-existing failure not caused by this task — add the failing job + step + date.
     3. **File a task** if the failure is real but out of scope — then proceed with the
        known-failures attribution so the CI signal stays meaningful.
     After triage, include `CI verdict: red — <job>/<step> — attributed to known-failures /
     fixed in commit <sha> / task T<id> filed` in the push report before telling the user.

   **Apply CLAUDE.md Landing Policy and dotask step 6.** Send the exact revision's proof
   bundle to a separate `subagent_type: proof-verifier`. Tests should be red before code
   changes; later-written tests must reproduce the intended failure against pre-change code
   and pass against the final code using the same test in isolated checkouts. Never check
   old source files over a shared working tree. Only independently VERIFIED proof, resolved
   code findings, and green CI for the same head permit automatic merge. Pin the merge to
   that head. Any conflict resolution or other change requires refreshed affected proof,
   review, and CI. Insufficient evidence returns to its author; human-only gaps go to the
   user with exact steps. The worker cannot certify or land its own work.
   The supervisor captures both independent verdicts and uses `scripts/landing_gate.py`
   from the approved controller checkout. Follow [landing-gate-usage.md](../../../docs/plans/landing-gate-usage.md);
   never replace a blocked gate with a direct `gh pr merge` call. Gate bootstrap/promotion
   requires the documented human-reviewed process; receipt capture is a host operation,
   not a worker continuation through `task.sh drive`.

6. **Cleanup is automatic** via the committed `post-merge` hook (`.githooks/post-merge`)
   when the branch lands on master. `nuke` archives the worker's `.dotask-profile/` to
   `C:\work\tasks\profiles\<SLUG>\` before deleting the checkout. Only step in if
   `/c/tmp/post-merge-cleanup.log` shows the container nuke was skipped — then
   `bash scripts/task.sh nuke <SLUG>`.

## Worker rules (bake into every kickoff)
- Follow the standard workflow at the task's TIER (CLAUDE.md § Task Tiers); stop at the
  architecture gate if design-gated.
- **Append a status line to `/workspace/.dotask-status` after every stage** (format in step
  2.5). End each dispatch with that phase's line: design `DESIGN_READY`, implementation
  `IMPL_READY`, QA `PUSHREADY <branch> <sha>`, or `BLOCKED <reason>` — never end quietly.
- Do not spawn a code reviewer: the supervisor's captured landing review is the authoritative
  one. Escalate a non-obvious root cause to the `expert` agent (Opus) only with a precise question.
- **Run only the relevant test set (~10 tests) for the corner of the code you changed** —
  feature tests + that corner's regression tests + one e2e spec. Never a full suite or a
  whole layer; CI is the full sweep. Name the set in the status line.
- Commit with EXPLICIT `git add <paths>` only — never `-A`/`-a`.
- **NEVER `git push` / `gh pr create`.** The container has NO push creds BY DESIGN, and `task.sh`
  installs a pre-push guard that hard-aborts inside the container. Commit, then STOP and report
  (branch + diffstat + QA); the SUPERVISOR pushes via `task.sh push`. Attempting a push only
  fumbles an auth failure and wastes tokens — don't. (The kickoff must say "commit and report",
  never "push a branch".)
- Do NOT change task statuses.
- Update the task's `.claude/knowledge/` doc(s) before declaring done (Stage 7).
- QA is part of the task (step 4): live-drive the feature, full test matrix, evidence per
  acceptance criterion. "Tests pass" without the matrix + live drive is an incomplete task.
- `/workspace/CLAUDE.local.md` already carries container facts (python path, test commands,
  DATABASE_URL, log fallback) — don't repeat them.

## Handy
- Inspect worker files without git: bind-mount at `C:\work\tasks\<SLUG>\…`
- Run the app on the branch: `bash scripts/task.sh stack <SLUG>` -> `http://localhost:<offset>`
- GUI worker (image paste): `bash scripts/task.sh code <SLUG>` (extension needs its own sign-in)
- Teardown: `bash scripts/task.sh down <SLUG>` (keep checkout) / `nuke <SLUG>` (delete)
