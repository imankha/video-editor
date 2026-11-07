# T12600: dotask headless auto-continue: NEEDS_USER relay, blocker classification, outcome ledger

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-10-12
**Updated:** 2026-10-12

## Problem

A dotask group runs one worker conversation per task. After each task commit, the user clears
the conversation and resends "Implement /workspace/.dotask-kickoff.md" by hand. We also cannot
tell how often a task goes straight through versus how often the worker needs the user, or why.
Status files hold about 40 ad hoc tokens and record no questions at all. That number is what
should decide between headless and a model supervisor.

A tracer run on 2026-10-12 ruled out automating the GUI. Full evidence is in
`scripts/dotask-tracer-ext/REPORT.md` on branch `feature/dotask-tracer-ext`.
- The Claude panel can be prefilled but never submitted. `claude-vscode.primaryEditor.open(undefined, prompt)`
  opens a new conversation with the text in the input, with no dialog. No route sends it.
- The terminal route (`claude-vscode.terminal.open(prompt)`, then `sendText` for `/clear` plus the
  prompt) does work with zero keypresses. But four first-run screens blocked it, invisibly to
  anything outside the terminal: the theme picker, a login screen, the Bypass Permissions warning
  and the renderer offer. Each turn also took about 30 s, against 2.3 s headless.
- Headless `claude -p` in the same container answered in 2.4 s with no screens, using the Max
  OAuth login with no `ANTHROPIC_API_KEY` set.

## Solution

Make headless the default auto-continue path, extending the existing `HEADLESS_LOOP` /
`task.sh drive`. No VS Code extension and no model in the trigger path.

1. **Trigger (deterministic).** Continue only when the dispatch ended AND the last status line
   matches `STAGE_DONE T<next> commit` exactly. Older workers also wrote mid-task lines such as
   `STAGE_DONE step3`. Each dispatch is a fresh context, so there is no `/clear`.
2. **Tagged questions.** The kickoff template tells the worker to write
   `NEEDS_USER T<id> <kind> "<question>"` and end its turn, never to wait on interactive input.
   `<kind>` comes from a closed list: `design_gate`, `clarify`, `decision`, `human_verify`,
   `env_blocked`, `stuck`. The loop stops, notifies the user, and accepts the answer through
   `task.sh drive <slug> --resume <session-id> "<answer>"`. The relaying chat reads only the status
   line plus a short tail, never the transcript.
3. **Blocker classification, never self-repair.**
   - Before each dispatch: the existing auth check (`AUTH_DEAD`) plus a guard that
     `ANTHROPIC_API_KEY` is unset.
   - During: a no-progress watchdog (status file and transcript unchanged for N minutes, then kill)
     and a wall-clock cap.
   - After: map the exit code, the JSON `is_error` and the result text to `blocked:quota` (with
     the reset time if given), `blocked:auth`, `blocked:transient`, `blocked:crash`,
     `blocked:hang`, `untagged` or `blocked:unknown`.
   - Transient errors retry once with backoff. A quota wait may resume after the reset time. All
     other kinds stop and notify with an exact remediation. There is never an automatic re-auth.
     `blocked:unknown` shows the raw error tail and is never retried.
4. **Outcome ledger.** One JSON record per dispatch in the group's checkout, with task, outcome
   (`auto_continued` / `needs_user:<kind>` / `blocked:<kind>` / `untagged`), timestamps, and the
   wait time for the user. A `dotask.sh status` summary prints the counts by outcome and kind.
5. **The window stays optional.** `task.sh code <slug>` to watch. `claude --resume` in its terminal
   to answer with a screenshot.

## Evidence from the first headless runs (2026-11-06)

Headless is now the default, and `autoland` covers verify and fix. This task still owns questions, the watchdog, stop classification and notifying the user. Six stalls, and what each one needs here:

- `npm ci` passed the 2-minute Bash limit and was backgrounded, ending the dispatch. Fixed: the container timeout is now 10 minutes. Add a `blocked:timeout` kind.
- Stale Vite cost a worker all 120 turns (`error_max_turns`, `budget_stop`). Fixed: polling. Add a `blocked:budget` kind and let the watchdog notice repeated runs of one spec.
- Group order contradicted a task file ("T14760 lands first"). `start` should read those lines and order the group, or refuse.
- A stale `BLOCKED` line in `.dotask-status` overrode a corrected kickoff, because the worker trusted it and skipped the notes. Fixed for the task id: the loop now names it. Resolved blockers still need a real `RESOLVED` line, not a hand edit of the status file.
- A worker spawned the expert agent and ended its turn to wait; agents are asynchronous under `claude -p`, so the dispatch and the expert both died (`ENDED_WITHOUT_STATUS`). Fixed: headless runs the expert as a foreground `claude -p --model opus`.
- There is no `dotask resume <slug>`: `start` re-inits, so restarts after a crash or a stop needed a hand-written launcher.

## Context

### Relevant Files (REQUIRED)
- `scripts/dotask_cli.py` - `HEADLESS_LOOP`, kickoff template (NEEDS_USER rule), status/ledger summary
- `scripts/task.sh` - `drive` (pre-flight guard, watchdog, post-run classification, `--resume` answer path)
- `scripts/dotask.sh` - wrapper surface for the answer/status commands
- `.claude/skills/spawn-worker/SKILL.md` - worker status-line protocol (add NEEDS_USER and the kinds)
- `.claude/skills/dotask/SKILL.md` - headless default, answer flow
- `scripts/test_dotask_cli.py` - loop outcome classification tests

### Related Tasks
- Evidence: tracer report on branch `feature/dotask-tracer-ext` (not merged; throwaway tooling)

### Technical Notes
- Container auth is per-task volume `reel-claude-config-<slug>`, seeded from the host's
  `~/.claude/.credentials.json`. A concurrent-refresh race exists (see the
  dotask quota/credentials incident notes). The watchdog and classifier must not touch credentials.
- The container CLI (`/usr/bin/claude`, image-pinned) differs from the extension's bundled binary.
  `claude -p` works without the interactive onboarding flags. Do not depend on those flags.
- The `Stop` and `UserPromptSubmit` hooks fire for headless and terminal sessions, but the
  transcript tail is empty at `Stop` time. Use status lines, not the transcript.
- Detection on the bind mount: in-container writes reach `fs.watch` in under 50 ms. Host writes
  never reach `fs.watch` and need polling. The loop runs host-side, so it reads the file after
  each dispatch and needs no watcher.
- Tier: likely L (new protocol across worker contract + loop + CLI). Design gate recommended for
  the kind taxonomy and ledger schema.

## Implementation

### Steps
1. [ ] Design: kind taxonomy, ledger schema, watchdog thresholds, answer command surface
2. [ ] Kickoff + spawn-worker contract: NEEDS_USER rule
3. [ ] Loop: stop on NEEDS_USER, classify blockers, transient retry, quota resume
4. [ ] `drive --resume` answer path
5. [ ] Ledger + status summary
6. [ ] Tests for each outcome branch (fake dispatch results)

### Progress Log

**2026-10-12**: Filed from the dotask tracer investigation (GUI auto-continue ruled out).

## Acceptance Criteria

- [ ] A group of 3 tasks with no questions runs start to PUSHREADY with zero user keypresses
- [ ] A worker question stops the loop, notifies with kind + question, and an answer resumes the same session
- [ ] Auth failure, quota limit, hang, crash and unknown errors each stop with their own kind and remediation; only transient retries
- [ ] The ledger records every dispatch outcome and `dotask.sh status` prints counts by outcome and kind
- [ ] Tests cover every outcome branch
