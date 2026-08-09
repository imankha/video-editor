# Session handoff — 2026-08-09 (B). Supersedes SESSION-HANDOFF-2026-08-09.md

**master @ `2210084c`.** Two workers in flight: T6680 (pushed, CI fix in progress) and T6700
(implementing). `C:/work/tasks/WAVE.md` is the live source of truth — read it first.

## 1. Cold-start bootstrap
1. Read `C:/work/tasks/WAVE.md`.
2. `docker ps --filter name=reel-task` — expect `reel-task-t6680` and `reel-task-t6700` up.
3. Tail `C:/work/tasks/t6680/.dotask-status` and `C:/work/tasks/t6700/.dotask-status`.

## 2. T6680 — pushed, one CI fix in flight
Branch `feature/T6680-default-athlete-intro-card-provisioning`. Removes the auto-inherited
default intro card entirely (every intro now requires an explicit consent-gated attach) — closes
a real hole that was live in production. Design approved, fully implemented, reviewed, QA'd live.

First push (`101702763b08...`) came back **Branch CI red on one test**:
`test_t5215_intro_attachment.py::test_collection_share_create_freezes_default_at_creation_time` —
a pre-existing test asserting the OLD "freeze the default's id" behavior this task intentionally
removed. Not a regression, just missed the local curated test set. **Fix dispatched to the
container, not yet confirmed done as of this handoff** — check `.dotask-status` for a line after
the `2026-08-09T16:28 PUSHREADY` one. If it says `PUSHREADY` again: `bash scripts/task.sh push
t6680` from the main checkout, then verify Branch CI properly (`gh run list --workflow "Branch
CI" --branch feature/T6680-default-athlete-intro-card-provisioning --limit 1`, then `gh run view
<id> --json jobs` for the real per-job conclusion — never trust `gh run watch`'s bare exit code).
Green → tell the user it's ready to test/merge. Red again → triage, don't just re-push blind.

**Landmine hit and fixed once already, won't recur but verify if resuming a stalled round:** the
worker committed all 10 implementation stages to a local `master` branch instead of the feature
branch. Recovered via `git branch feature/T6680-... HEAD` + checkout + `git branch -f master
origin/master` (no commits lost). If a future round on this container ever shows uncommitted work
sitting on `master`, that's this same class of bug — check `git branch --show-current` before
trusting any `.dotask-status` "committed" line.

## 3. T6700 — implementing normally
Branch `feature/T6700-owner-inapp-playback-intro`. Adds the intro pre-roll to the owner's own
in-app Play button (reel + collection) — the 5th egress path T5220 didn't cover. Design approved,
no open questions. As of this handoff: backend endpoints done + tests green (`31852c10`), now on
the frontend slice (`DownloadsPanel.jsx` swap + fetch wiring). No file overlap concern anymore —
T6680 already pushed its `downloads.py`/`collections.py` changes, so T6700 building on top of
current master is fine once it next syncs; if it was cloned before T6680 pushed, it'll hit a
normal merge conflict on those two files at push time — expected, not a bug, just resolve it.

Resume pattern if a round dies mid-stage (fresh-seed if idle >1h, else `-c`):
```
docker exec -u dev reel-task-t6700 bash -lc 'cd /workspace && claude -p -c --model sonnet
"Continue from the last STAGE_DONE line in .dotask-status."'
```

## 4. Landmines worth carrying forward (condensed)
- **Auth-token rotation**: if a container's `claude -p` returns instant `Not logged in`, compare
  `docker exec -u dev <container> stat -c%s /home/dev/.claude/.credentials.json` (via
  `MSYS_NO_PATHCONV=1` — Git Bash mangles `/home/dev/...` paths otherwise) against the host's
  `~/.claude/.credentials.json` size. Re-seed via `docker cp` + `chown dev:dev` + `chmod 600` (in
  that order — a root-owned unreadable file looks identical to a missing one from the error alone).
- **600s background-wait ceiling**: a `claude -p` session waiting on its own spawned background
  task self-terminates at 600s with no final status line (NOT a crash, NOT quota death — the
  spawned work often finishes fine, just unread). Set `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` on
  any resume expected to run something long (dev-verify.sh, a full test suite).
- **The shared main checkout (`c:/Users/imank/projects/video-editor`) is unsafe for git
  operations** — was detached HEAD, may still be. File edits fine, commits/merges not. Use a
  container checkout (this session used `C:/work/tasks/t5230`, idle and kept in sync with
  `origin/master` for exactly this purpose) for any supervisor-side doc/plan commits.
- **When committing a `git mv`, never scope `git commit` to an enumerated pathspec list** — a
  rename's delete-half at the OLD path can fall outside the list and silently never commit,
  leaving a duplicate file in `HEAD` at both paths (hit and fixed this session, `ced31283`). Use
  `git add -A -- <dir>` then commit the whole index, and sweep `git ls-tree -r HEAD --name-only |
  grep <basename>` for each moved file before pushing to confirm exactly one copy exists.

## 5. Epic structure (current shape, not the story)
Player Intro (`docs/plans/tasks/player-intro/EPIC.md`) is the one active epic — a separate
"Overlay Text" epic was tried and dissolved same-session; everything folded back in. Notable
non-default positioning: **T6630** (Overlay text add/remove/drag, still TODO) is deliberately the
last row in PLAN.md's UI-runway milestone, immediately before the tutorial reshoot (T5140) — real
user-facing breakage the reshoot shouldn't capture. **T6500** (font catalogue) is pushed out,
plain top-level task, not epic-tracked, not gating anything.

## 6. Next
Once both workers report `PUSHREADY` + green CI: hand both branches to the user to test, in
either order (no dependency between T6680 and T6700 beyond the file overlap already resolved by
push order). No other tasks queued — WIP is 2/2, don't start a third until one banks.
