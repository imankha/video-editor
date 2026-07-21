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
   **`up` calls must run SEQUENTIALLY across workers** — `alloc_offset` in task.sh scans
   ports then persists the offset to `<checkout>/.task-env` without a lock, so parallel
   `up`s grab the same offset and the losers fail with "port is already allocated".
   Recovery from a poisoned worker: `docker rm -f reel-task-<SLUG>`, delete
   `C:\work\tasks\<SLUG>\.task-env`, re-run `up`. Only the step-3 drive calls parallelize.

3. **Drive** with headless CLI calls; ALWAYS `run_in_background: true` so other workers and
   the supervisor keep moving:
   ```
   docker exec -u dev reel-task-<SLUG> bash -lc 'cd /workspace && claude -p <MODEL_FLAGS> "<instruction>"'
   ```
   **Pick `<MODEL_FLAGS>` from the task's TIER** (quota control — the default is Opus at
   `xhigh`, which is right for design work and wasteful for spec-following):

   | Tier | Stage | Flags | Why |
   |------|-------|-------|-----|
   | S | all | `--model sonnet --effort low` | <10 LOC, no decisions to make |
   | M | all | *(none — Opus, default effort)* | no Architect ⇒ the implementor IS making design calls |
   | L | up to the design gate | *(none — Opus)* | architecture is the expensive part |
   | L | after design approval | `--model sonnet` on the `-c` resume | the design doc + failing tests ARE the spec |

   The rule behind the table: **cheap model iff a spec exists upstream** (approved design doc,
   failing tests, or Tier-S triviality). If the worker is deciding rather than executing, it
   stays on Opus. `-c` accepts `--model` / `--effort`, so a resumed session can switch tiers
   mid-task without losing context.
   - First call: "Read /workspace/.dotask-kickoff.md and execute it. If design-gated, stop at
     the approval gate and summarize the design + open questions."
   - Continue the SAME worker session across stages with `claude -p -c "<next instruction>"`.
     `-c` is safe because each container has its OWN ~/.claude volume (task.sh auth_volume);
     in a container created before that fix (shared volume), `-c` resumes a RANDOM worker's
     session — there, send a FRESH `claude -p` whose prompt is self-contained (name the
     branch, commits, and kickoff path) instead of resuming.
   - Workers share the user's subscription quota; a parallel wave can hit the session limit
     mid-QA. On "session limit" output: wait, probe with a 1-word `claude -p`, then re-send.
   - **Relay gates to the user**: surface design/decisions in the supervisor chat, get the
     answer, pass it down with `-c`.
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
   - **Adversarial self-check**: re-read the task's acceptance criteria one by one and show
     evidence per criterion (test name or live-drive observation). Unverified criterion =
     task not done.
   - **Evidence artifacts, not prose**: use `src/frontend/e2e/helpers/qa.js` —
     `saveEvidence(page, 'criterion-N-...')` screenshots each criterion's end state into
     `<repo>/qa/` (gitignored; readable from the host at `C:\work\tasks\<SLUG>\qa\`).
   - **Responsive check (any UI change)**: `responsiveSweep(page)` runs the changed screen at
     375px + desktop, asserts no horizontal overflow, and saves both screenshots.
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

5. **Push for the user to test:** once implementation done + QA evidence per criterion +
   tests green + knowledge doc(s) updated (Stage 7), sanity-check the diffstat, then:
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
   Report: fetch origin -> switch to `feature/T<id>-…` -> CI verdict -> test -> merge.

6. **Cleanup is automatic** via the committed `post-merge` hook (`.githooks/post-merge`)
   when the branch lands on master. Only step in if `/c/tmp/post-merge-cleanup.log` shows the
   container nuke was skipped — then `bash scripts/task.sh nuke <SLUG>`.

## Worker rules (bake into every kickoff)
- Follow the standard workflow at the task's TIER (CLAUDE.md § Task Tiers); stop at the
  architecture gate if design-gated.
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
