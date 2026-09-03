---
name: spawn-worker
description: "Supervisor-side subroutine: spin up ONE permission-free container worker for a task and drive it to a pushed branch via the status-file contract (no polling turns). Not a user command — /dotask (or any supervisor flow the user approved) invokes this per task, respecting the WIP limit of 4 (all pairs file-disjoint, quota fresh)."
license: MIT
author: video-editor
version: 2.0.0
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
   ```
   - The worker's FINAL act is always `PUSHREADY <branch> <sha>` (commit done, QA evidence
     complete, ready for the supervisor to `task.sh push`) or `BLOCKED <reason>`. A worker is
     never "quietly finished".
   - **Liveness rule:** exit-0 silence is meaningless (finished / quota-dead / auth-dead look
     identical). The status file disambiguates: `PUSHREADY`/`BLOCKED` = done; a background
     drive call that returned WITHOUT a new status line = the worker died mid-stage
     (quota/auth) or ended its turn early — resume it (step 3 resume rules), don't forensically
     re-read transcripts.

3. **Drive** with headless CLI calls; ALWAYS `run_in_background: true` so other workers and
   the supervisor keep moving:
   ```
   docker exec -u dev reel-task-<SLUG> bash -lc 'cd /workspace && claude -p <MODEL_FLAGS> "<instruction>"'
   ```
   **Pick `<MODEL_FLAGS>` from the task's TIER** (quota control — always pass the flag
   EXPLICITLY; never rely on the account/session default, which varies):

   | Tier | Stage | Flags | Why |
   |------|-------|-------|-----|
   | S | all | `--model sonnet --effort low` | <10 LOC, no decisions to make |
   | M | all | `--model opus` | no Architect ⇒ the implementor IS making design calls |
   | L | up to the design gate | `--model opus` | architecture is the expensive part |
   | L | after design approval | `--model sonnet` on the resume | the design doc + failing tests ARE the spec |

   The rule behind the table: **cheap model iff a spec exists upstream** (approved design doc,
   failing tests, or Tier-S triviality). If the worker is deciding rather than executing, it
   stays on Opus. `-c` accepts `--model` / `--effort`, so a resumed session can switch tiers
   mid-task without losing context.
   - First call: "Read /workspace/.dotask-kickoff.md and execute it. Append a status line to
     /workspace/.dotask-status after every stage. If design-gated, stop at the approval gate,
     write a BLOCKED line, and summarize the design + open questions."
   - **Resume rules (`-c` vs fresh — the re-context tax is real):** `-c` re-uses the session
     but after the prompt cache expires (~1h idle) it RE-WRITES the entire conversation as
     cache-creation tokens (~the full context, 100-400k). So: continue with
     `claude -p -c "<next instruction>"` only when the last worker activity was recent
     (status-file timestamp < ~1h old). Otherwise send a FRESH `claude -p` seeded from files:
     "Read /workspace/.dotask-kickoff.md and /workspace/.dotask-status. Branch <branch> has
     commits through <sha>. Continue from the last STAGE_DONE line." (~5k tokens vs ~400k.)
     `-c` is per-container-safe (own ~/.claude volume); pre-fix shared-volume containers
     always get the fresh-seed form.
   - **Worker turn budget ~300:** a worker grinding past ~300 turns without PUSHREADY is a
     signal (mis-tiered task, stuck loop), not normal. Stop it, read the status file, and
     either re-scope or resume fresh from the checkpoint — don't let it run to quota death.
   - Workers share the user's subscription quota. On "session limit" output: write the time
     down, wait for the reset, then resume via the fresh-seed form (the cache is dead by then
     — never `-c` across a quota gap).
   - **Relay gates to the user**: a BLOCKED status line surfaces the question in the
     supervisor chat; get the answer, pass it down (recent cache: `-c`; else fresh-seed).
   - The clone carries `.claude/settings.json`, so the eslint/ruff PostToolUse hook runs
     inside the container too — the worker gets lint feedback automatically.

4. **QA phase (MANDATORY — never push without it):** implementation done is not task done.
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
     flow. `npx vitest related --run <changed sources>` is a CANDIDATE FINDER, not a run
     list — curate its output down to the relevant set. More complexity = a bigger relevant
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
   - **Responsive check (any UI change)**: `responsiveSweep(page)` runs the changed screen at
     375px + desktop, asserts no horizontal overflow, and saves both screenshots. The
     screen-usability audit runs for the CHANGED screen(s) only
     (`npx playwright test screen-usability.spec.js --grep "<screen>"`), not the full
     5-viewport matrix over every screen.
   - **Perf guards (when queries/endpoints changed)**: backend — use the `query_counter`
     pytest fixture (seed N rows, assert statement count stays flat; see
     tests/test_query_counter.py); frontend — assert a sane timing budget in the e2e spec
     (e.g. changed screen interactive < 3s on the local stack).
   - **Pre-existing failures**: compare against docs/testing/known-failures.md instead of
     re-proving them; a NEW failure not on that list is yours to fix or explain.
   QA is the single largest token sink in a task (live-driving Playwright, screenshots, full
   test matrix) and is almost entirely spec-following — the acceptance criteria are the spec.
   **Run it on Sonnet at `medium` effort regardless of tier.** If the first `claude -p` run
   finished without this, the supervisor sends a continuation:
   `claude -p -c --model sonnet --effort medium "QA phase per kickoff: drive the feature live,
   complete the test matrix, map every acceptance criterion to evidence. Report the evidence."`
   Fallback if the worker is blocked: supervisor runs `bash scripts/task.sh test <SLUG>`.

5. **Push, then merge if provably verified (else hand off for user test):** once
   implementation done + QA evidence per criterion + tests green + knowledge doc(s) updated
   (Stage 7), sanity-check the diffstat, then:
   ```
   bash scripts/task.sh push <SLUG>
   ```
   **Mandatory CI-verdict step (do NOT skip):** after the push, fetch the Branch CI result
   before reporting the branch ready:
   ```
   # Poll until the run appears (the webhook can lag a few seconds after push)
   for i in 1 2 3 4 5; do
     RESULT=$(gh run list --workflow "Branch CI" --branch <branch> --limit 1 \
               --json databaseId,status,conclusion)
     [ "$(echo "$RESULT" | jq 'length')" -gt 0 ] && break
     sleep 10
   done
   RUN_ID=$(echo "$RESULT" | jq -r '.[0].databaseId')
   # Wait for completion, exit non-zero on failure
   gh run watch "$RUN_ID" --exit-status
   # Fetch failing job + step names (not full logs) for the verdict line
   gh run view "$RUN_ID" --json jobs --jq '.jobs[] | select(.conclusion=="failure") | {job:.name, step: [.steps[] | select(.conclusion=="failure") | .name]}'
   ```
   - **GREEN**: report `CI verdict: green` and tell the user which branch to test.
   - **RED**: DO NOT tell the user to test yet. Triage in the supervisor chat:
     1. **Fix in the worker** (`claude -p -c`) if it is a real regression introduced by this task.
     2. **Attribute to known-failures.md** (`docs/testing/known-failures.md`) if it is a
        pre-existing failure not caused by this task — add the failing job + step + date.
     3. **File a task** if the failure is real but out of scope — then proceed with the
        known-failures attribution so the CI signal stays meaningful.
     After triage, include `CI verdict: red — <job>/<step> — attributed to known-failures /
     fixed in commit <sha> / task T<id> filed` in the push report before telling the user.

   **Once CI is green, decide merge vs hand-off — [[feedback_merge_when_provably_verified]]
   is the standing default, not a per-task question:**
   - **Provably verified** (a test that would have failed before the fix and passes after, on
     the real production code path — not an argument-shape/mock check — plus CI green) ->
     merge without waiting for a reply: `gh pr create` -> `gh pr merge --merge
     --delete-branch` -> flip the task's PLAN.md row + task-file `**Status:**` to STAGING ->
     commit and push that status flip in the supervisor checkout -> THEN tell the user what
     merged and why it's proven. If the worker's status file doesn't already contain an
     explicit red->green transition, produce it yourself before merging rather than skipping
     it or asking the user to: `git checkout <pre-fix-commit> -- <the changed source files>`
     (leave the new/updated test files alone), run just the directly-affected test file(s),
     confirm they fail, `git checkout HEAD -- <those source files>`, confirm they pass again.
     If the merge needs a `git merge origin/master` first (branch is behind — common when
     several workers land close together), resolve any conflicts, re-run the same tests to
     confirm still-green, then push and merge.
   - **Not provable without a human** (visual/UX judgment, a live external integration, a step
     only reproducible in staging) -> this is the real "push for the user to test" path: leave
     the branch open, report CI verdict + specific test steps mapped to acceptance criteria,
     and wait for their word.
   - Topic sensitivity (security, payments, P0) is never its own exception to the proof bar.

6. **Cleanup is automatic** via the committed `post-merge` hook (`.githooks/post-merge`)
   when the branch lands on master. Only step in if `/c/tmp/post-merge-cleanup.log` shows the
   container nuke was skipped — then `bash scripts/task.sh nuke <SLUG>`.

## Worker rules (bake into every kickoff)
- Follow the standard workflow at the task's TIER (CLAUDE.md § Task Tiers); stop at the
  architecture gate if design-gated.
- **Append a status line to `/workspace/.dotask-status` after every stage** (format in step
  2.5). Final act is always `PUSHREADY <branch> <sha>` or `BLOCKED <reason>` — never end
  quietly.
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
