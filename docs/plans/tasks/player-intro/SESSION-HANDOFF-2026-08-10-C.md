# Session handoff — 2026-08-10 ~20:50 UTC

**master @ `9a0048d4`.** This session merged T6420 (tile hover preview, STAGING) and did a
round of PLAN.md reprioritization + doc cleanup. It did NOT spawn new implementation work — the
next session's job is to actually build the batch queued up below, then clear.

## Goal: clear everything queued ahead of T5140, then stop

The user wants ONE session to finish **T6350, T6345, T6410, and T6441** — all four now sit
immediately before [T5140](../T5140-reshoot-tutorial-videos.md) (the tutorial reshoot) in
PLAN.md, moved there deliberately today so the reshoot has a clean run-up. **T5140 itself is
OUT OF SCOPE for this session** — it's the user's own video-recording work in
`C:/Users/imank/Videos/Captures/ReelBallersTutroials`, not something an agent session builds.
Once all 4 tasks are pushed (ideally merged/tested), this session's job is done — clear it.

## The 4 tasks

| ID | What | Size | Notes |
|----|------|------|-------|
| [T6350](../T6350-move-reels-half-apply-on-sync-failure.md) | move-to-profile half-applies, user told "not moved" when it actually was | Persistence/sync bug | Task file already names 3 fix options with a recommendation (honest reporting, smallest correct option) — this reads as decided, but confirm before implementing rather than assuming. Sync/CAS-adjacent — per CLAUDE.md Model Policy, consider the `expert` agent if root cause isn't obvious on first read. |
| [T6345](../T6345-postgres-migration-runner-skips-version-gaps.md) | postgres migration runner uses MAX(applied) instead of a set-membership check, silently skips out-of-order migrations | Small, clear fix + regression test named in the task file | Lowest complexity of the 4 (Cmplx 2) — good first pick. |
| [T6410](../T6410-migration-swap-discards-unsynced-writes.md) | profile_db migration swap can discard unsynced local writes during the deploy window | Persistence/sync bug | Same territory as T6350 — CAS/durable-write adjacent, consider the expert agent for the fix shape even though the task file already names one. |
| [T6441](../tile-video-preview/T6441-hover-preview-in-overlay-drafts.md) | extend hover-preview (T6420) to "In Overlay" drafts, not just Ready/Done | S/M, one-line frontend fallback, zero backend work (endpoint already exists) | Small enough to build **inline in the shared session, no container** — the dotask container-gate rule exists exactly for tasks this size. Don't spin up `/dotask 6441` unless the session genuinely prefers to. |

Read each task file in full before starting — they're self-contained (root cause, fix shape,
test plan already written). Run Stage-0 classification per CLAUDE.md before touching code; do
not skip it just because the task files look pre-decided.

## Suggested sequencing

T6350/T6345/T6410 are file-disjoint from each other (move_reels sync path, migration runner
`base.py`, and `_migrate_profile_db` respectively) — WIP=1 is the safe default per this
project's established dotask discipline (see `.claude/skills/dotask/SKILL.md`); bump to WIP=2
only if the session judges the quota is fresh and wants the throughput, never 3-wide (the
2026-08-06 burn incident is why that rule exists). T6441 doesn't need a WIP slot at all if done
inline.

A reasonable order: T6345 first (smallest, cleanest), then T6350 and T6410 (queue or pair,
supervisor's call), with T6441 done inline whenever there's a natural gap — it doesn't block or
get blocked by the other three.

## Landmines from this session (read before touching the shared tree)

- **This checkout can carry a stale detached HEAD.** Always `git fetch origin master` and
  compare SHAs before trusting anything read from local disk — this bit the session twice
  today (a stale local PLAN.md, and later a genuinely stale checkout 130 commits behind).
- **`git push origin master` from a detached HEAD can silently target the WRONG ref.** This
  checkout has a real local branch named `master` that's been sitting untouched, 129+ commits
  stale (it's also checked out in an unrelated worktree at `C:/work/land-master`, so it can't
  even be checked out here to fix). A bare `git push origin master` resolves to THAT stale
  local branch, not your current commit, and fails non-fast-forward in a confusing way. Use
  `git push origin HEAD:master` when committing directly in this checkout, or push from a
  throwaway scratch clone instead (the pattern used for every other doc push this session —
  clone fresh from `origin/master`, edit, commit, push, delete the clone).
- **Never `git reset --hard` or discard uncommitted changes in this shared tree without
  verifying first** (`git diff origin/master -- <file>` to prove staleness/superseded-ness, the
  way T6690's and T5200/T6520's stale duplicates were confirmed safe to discard this session).
  Assume nothing here is disposable until you've checked.
- **Container Vite dev servers can serve stale transformed source after an edit that never
  self-heals via browser refresh** (documented pre-existing landmine, hit again this session on
  T6420). If a code change doesn't seem to take effect in a running container, `curl` the raw
  served module to check before assuming a logic bug — kill and restart the dev server if it's
  stale, don't debug phantom behavior.
- Explicit `git add <paths>` only, everywhere — never `-A`, never blanket stash.

## Next

Once T6350/T6345/T6410/T6441 are all pushed (and merged if the user tests+approves promptly),
update PLAN.md status for each and this session is done. T5140 is next on the board but is not
this session's job to start.
