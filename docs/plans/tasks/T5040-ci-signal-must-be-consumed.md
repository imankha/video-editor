# T5040: Branch CI red for 9+ days and nobody noticed — make the signal consumed, not decorative

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

Every Branch CI run in the visible history is a failure — 20/20 runs across
12 branches, 2026-07-10 → 2026-07-13 — and the backend job has been dead
since the workflow was CREATED (2026-07-04, T5020). During that window ~10
branches were QA'd by workers, pushed, user-tested, and merged to master with
nobody consuming the CI verdict. A genuinely broken branch would have looked
identical to a healthy one.

The gap is structural, not personal: the /dotask land step reports "branch
ready" the moment `task.sh push` succeeds; nothing in the supervisor flow,
the skills, or the merge path reads the CI conclusion. An always-red CI then
self-reinforces: red is the baseline, so red is noise.

## Solution

Close the loop at the two points where the signal should gate:

1. **Supervisor land step (skills change)**: after `task.sh push <SLUG>`, the
   supervisor MUST fetch the branch's CI verdict before reporting the branch
   ready:
   `gh run list --workflow "Branch CI" --branch feature/T<id>-... --limit 1`
   → wait for completion (`gh run watch <id>` or poll), then report
   green/red WITH the failing step names. A red verdict is triaged in the
   supervisor chat (fix in worker / attribute to known-failures / task it)
   BEFORE the user is told to test. Encode this in
   `.claude/skills/spawn-worker/SKILL.md` (step 5) and
   `.claude/skills/dotask/SKILL.md` (step 6).
2. **Baseline honesty**: CI is only a signal when green is achievable. This
   task therefore FOLLOWS T5020 + T5030 (which make green possible) and adds
   the guard that keeps it meaningful: a short "CI verdict" line in the
   worker report template (kickoff template in task-management/SKILL.md), so
   every future task report carries pass/fail + attribution.
3. **Optional hard gate (decide with the user, don't assume)**: GitHub branch
   protection requiring Branch CI on PRs into master. The current flow merges
   locally via CLI (no PRs), so protection would change the merge workflow —
   present the trade-off (CLI merge speed vs enforced gate) and let the user
   pick; do NOT silently enable it.

## Context

### Relevant Files (REQUIRED)
- `.claude/skills/spawn-worker/SKILL.md` — step 5 (push) gains the CI-verdict step
- `.claude/skills/dotask/SKILL.md` — step 6 (land) mirrors it
- `.claude/skills/task-management/SKILL.md` — kickoff/report template line
- (decision-gated) GitHub repo settings — branch protection

### Related Tasks
- Blocked by: T5020 (backend CI must be able to run) and T5030 (frontend gate
  must be passable) — enforcing a red-by-construction CI would just freeze all
  work.
- Origin: 2026-07-12/13 derisk sweep + wave (T4960/T4980 both pushed with red
  CI that turned out to be pre-existing — the triage cost of proving that is
  exactly what this task amortizes).

### Technical Notes
- `gh run list --branch <branch>` can race the webhook (run not created yet);
  poll with a short backoff before concluding "no run".
- Keep the check cheap: verdict + failing step names, not full logs — the
  supervisor pulls logs only when triaging.
- known-failures.md remains the attribution ledger; the skills change should
  reference it as the triage path.

## Implementation

### Steps
1. [ ] Wait for T5020 + T5030 to land (CI green achievable on a clean branch).
2. [ ] Edit the three skill files: push → await CI verdict → triage-or-report.
3. [ ] Dry-run: push a trivial branch, confirm the documented flow produces a
       green verdict line; push a branch with a deliberate lint error, confirm
       the flow surfaces the red + failing step.
4. [ ] Present the branch-protection option to the user; apply only on
       explicit yes.

### Progress Log

**2026-07-13**: Created from the CI audit after the derisk wave. Run history
evidence: `gh run list --workflow "Branch CI" --limit 20` → 20/20 failure.

## Acceptance Criteria

- [ ] spawn-worker/dotask skills instruct the supervisor to fetch + report the
      branch CI verdict before declaring a branch ready
- [ ] Worker report template carries a CI-verdict line
- [ ] Dry-run evidence: one green report, one red report with failing steps
- [ ] Branch-protection decision recorded (yes/no) with the user's answer
