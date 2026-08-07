# Session handoff — 2026-08-07 ~13:35 PDT / 20:35 UTC. Supersedes SESSION-HANDOFF-2026-08-07-B.md

**master @ `bb53188b`** unchanged this session (T6640 already merged per -B). Everything
below is LIVE STATE, forward-looking only. Prior handoffs are history; do not re-read them.

**Operating mode unchanged from -B**: user tests a container port, gives notes, supervisor
briefs the SAME container/session for another round (`claude -p --resume <session-id>`).
Workers NEVER push — the supervisor pushes from the shared host checkout via
`git fetch C:/work/tasks/<slug> <branch>:<branch> && git push origin <branch>`.

---

## 1. DO THIS FIRST

**T5215's Branch CI is RED right now** (run `31215654537`, pushed at `b2f7d4eb`). Do not
re-push/re-run until the round-8 fix (in flight, see §2) lands and passes locally.

**Poll both containers' actual process state before trusting any status** — see §6's
operational facts, especially the orphaned-process landmine that bit this session hard.

---

## 2. T5215 (`reel-task-t5215`, :5176/:8003) — 8 rounds deep, CI red, fix in flight

Branch `feature/T5215-intro-attachment`. Pushed once (`b2f7d4eb`, round 7 tip) — that push
is what CI is red against. Round 8 (CI fix) was in progress when this handoff was written;
check `git log --oneline -3` in the container before assuming it's done.

**Migration already renumbered correctly**: v037 → v041 (`v041_intro_min_duration.py`,
`V041IntroMinDuration`), all guard tests updated (`test_registry_head_is_v041`,
`HEAD_VERSION_AUDITED = 41`). Do not touch this again.

### CI failure 1 — REAL REGRESSION, root-caused, fix briefed (round 8, `round8-ci-fix.md`)
`tests/test_t6030_slowmo_migration_window.py::test_finalize_guard_is_one_probe_not_per_row`
— `_finalize_overlay_export` (`app/routers/export/overlay.py` ~line 121-153) now runs
`PRAGMA table_info(final_videos)` TWICE (once for `_has_intro` via T5215's new
`column_exists()` call, once for the pre-existing `_has_slowmo` check) where the test
guards exactly one. Fix: consolidate into one shared `PRAGMA table_info` fetch, mirroring
the pattern already used in `v033_heal_moved_reel_attribution.py`. Full brief in the
container at `/workspace/round8-ci-fix.md`.

### CI failure 2 — likely unrelated, needs confirmation (also in round 8's brief)
`tests/test_vacuum_on_signout.py::test_logout_fires_vacuum_when_user_archived` fails with
`Postgres pool not initialized` — smells like test-order/global-state leakage from an
unrelated test, not a T5215 regression (T5215 never touches logout/vacuum/analytics code).
Round 8 was told to run it in isolation to confirm before touching anything.

### After round 8 lands
1. Read its report. If failure 1 is fixed and failure 2 is confirmed unrelated: push
   (`git fetch C:/work/tasks/t5215 feature/T5215-intro-attachment:feature/T5215-intro-attachment
   && git push origin feature/T5215-intro-attachment` from the shared host checkout), watch
   Branch CI (`gh run list --branch feature/T5215-intro-attachment --limit 3`, then
   `gh run view <id>` — **verify the actual conclusion, `gh run watch --exit-status`'s exit
   code alone was misleading this session**), merge, delete the branch (local + remote).
2. If failure 2 turns out to be real/related: do not merge, brief another fix round.

### What's in this branch (8 rounds of user-driven QA, all committed)
Attachment + resolution (picker SELECT→PREVIEW→CONFIRM with explicit OK commit, badges
reflecting real attachment state positioned next to the rank chip, profile photo
thumbnail sized 56×100, collection-level intro badge on the media slot, the T5673
leading-reel poster thumbnail removed per explicit user confirmation, picker
default-selection fixed for the "nothing to inherit" case). **User already told: intro
cards do NOT actually play during reel playback yet — that's T5220 ("apply the intro at
every egress"), a separate not-yet-started task. This is expected, not a bug**, confirmed
with the user mid-session.

---

## 3. T6630 (`reel-task-t6630`, :5175/:8002) — round 7 COMPLETE, needs push prep

Branch presumably `feature/T6630-...` (same as prior handoffs). Round 7 just landed: **7
commits, clean tree, not pushed, not yet handed to the user to test.**

**Before handing to the user**: restart both servers (they're stale relative to the new
commits — check process start time vs `git log -1 --format=%ci`, this bit every single
round this session) and curl-verify a real code token from the served bundle before
trusting it.

**Migration still holds v039** (`T6630`'s own migration) — master is now well past that
(v040 before this session, and T5215 will land v041 once merged). **Renumber above
whatever the merge-time head is** before this branch can merge — same numbering-trap
process as T5215's v037→v041 fix this session (rename file, class, `version =`, the
`MIGRATIONS` registry, and any test asserting the head version / absence of the old
number). Do this AFTER T5215 merges, not before, so you renumber against the real
post-T5215 head.

### Round 7 summary (all 6 items from round7.md + round7-addendum.md)
1. Removed the `selectedRegionId` short-circuit from the Text tab's playhead-scoping
   filter (a stale copy from a different call site); found + fixed a float-precision edge
   case where a just-created region could render hidden.
2. Active regions now render as an expand/collapse tree (region → nested elements → per-
   region "add text"), scoped strictly to the playhead.
3. New region/element seed text is now `"Text region N, element M"`, not static `"Your
   text"`.
4. Position-preset priority changed to top-right-first (was bottom-center-first); no
   actual missing-preset bug was found (likely a stale-restore race the user hit once).
5. Poster/thumbnail marker: fixed a REAL drag-math bug (wrong reference frame, ~412px
   drift) AND added auto-scroll-follow reusing the playhead's own
   `computeFollowScrollTarget` (`TimelineBase.jsx`) — user's explicit direction: "the
   marker should move just like the playhead."
6. Changed the actual poster-frame DEFAULT algorithm — both `poster.py` (backend,
   authoritative/export-time) and `posterWindow.js` (frontend preview mirror) — from
   window-midpoint to `window.start + 2.0` (confirmed via user Q&A: "2s into the
   open-play window," NOT 2s from clip start — deliberately does not collide with
   `SPOTLIGHT_SKIP_SECONDS`, the existing worst-ranked-instant skip). Manual override
   path (dragging the marker yourself) is unchanged. This surfaced and fixed a real
   async-timing race in the marker's initial-reveal position.

112 frontend unit + 49 backend tests pass; full e2e suite passes (re-verified twice for
item 6's race). Occasional e2e flakes this round were confirmed to be the SAME documented
concurrent-container account interference (§6), not new breakage.

---

## 4. Resume commands (both sessions resumable; containers survive)

```
docker exec -d -u dev reel-task-t5215 bash -lc 'cd /workspace && claude -p --resume ea8322fc-4645-45b4-83b8-541467ee09a7 --model sonnet "<prompt>" > /tmp/<name>.output 2>&1'
docker exec -d -u dev reel-task-t6630 bash -lc 'cd /workspace && claude -p --resume a2ddc9d9-f812-4798-b248-ff18c45d623f --model sonnet "<prompt>" > /tmp/<name>.output 2>&1'
```

**Never trust a single poll.** The reliable liveness check (grep-by-cmdline, not `ps`,
which isn't installed):
```
docker exec -u dev <container> bash -lc 'for p in /proc/[0-9]*; do tr "\0" " " < $p/cmdline 2>/dev/null; echo; done | grep -c "resume <session-id-prefix>"'
```
A result of `0` means genuinely exited — cross-check `git log --oneline -1` and the
`.output` file's tail before believing a round is "ready."

---

## 5. Poll-for-completion pattern that actually works

`docker exec -d` backgrounds the worker; poll from the HOST side (not nested `bash -c`
inside the container — a nested-escaping bug produced a false "worker exited" reading
once this session before it was caught). Cap each poll at ~55×10s (~9min) and relaunch —
rounds in this session regularly ran 30-80+ minutes. A poll timing out is NOT a signal
anything is wrong; check `git log`/file-mtimes directly to confirm the worker is still
producing output before relaunching, same pattern as above.

---

## 6. OPERATIONAL FACTS EARNED THE HARD WAY THIS SESSION (do not re-derive)

- **Premature yield still happens, watch for it every round.** A worker ended its turn
  "waiting for a background E2E run notification" that will never arrive (headless, no
  notifications). The run had ALREADY FINISHED (and failed) by the time it gave up.
  Detect via: process genuinely exited (`grep -c` above returns 0) but the task isn't
  actually done (no new commit, or the `.output` file's last line is a "waiting for..."
  sentence). Fix: resume with an explicit "that run already finished, check
  `test-results/artifacts/.last-run.json` directly, do not wait on anything" nudge.
- **Auth death signature unchanged**: `.credentials.json` drops 508→280 bytes (or
  whatever the host's current byte count is, it can drift — check the HOST'S current
  size and match containers to THAT, not a hardcoded 508), worker exits `Not logged in`.
  Hits both containers close together (shared refresh-token rotation). Fix:
  `docker cp <host-creds> <container>:/tmp/creds.json` then as root `install -o dev -g
  dev -m 600 /tmp/creds.json /home/dev/.claude/.credentials.json`. Re-seed BOTH
  containers together even if only one shows the drop — proactive, not reactive.
- **NEW this session — killing a `--reload` uvicorn parent can orphan a child that KEEPS
  THE PORT BOUND with a stale open file handle.** `kill -9 <parent-pid>` is not enough:
  the reloader's forked worker (or in one case, an unrelated multiprocessing
  resource-tracker/spawn_main child that inherited the fd) can survive and keep serving
  on the port using a handle to a file you just deleted — `curl .../health` returning 200
  after your "restart" does NOT prove your new process is the one answering. **Verify
  which PID actually holds the listening socket** before trusting a restart:
  ```
  docker exec -u dev <container> bash -lc 'for p in /proc/[0-9]*; do pid=$(basename $p); for fd in $p/fd/*; do link=$(readlink $fd 2>/dev/null); [ "$link" = "socket:[<inode>]" ] && echo "$pid holds it"; done; done'
  ```
  (get `<inode>` from `grep :<port-hex> /proc/net/tcp`). This bit hard: an `rm -rf
  user_data/<user_id>` recovery for a `stale_baseline` conflict appeared to wipe the
  user's games/reels — they were never actually lost (R2 is canonical, untouched), but a
  stale orphaned worker with a warm `_initialized_users` in-memory cache answered
  post-restart requests and skipped the automatic R2-restore-on-missing-local-file path
  (`app/database.py::ensure_database`, `app/services/user_db.py`), instead creating a
  blank local DB. A GENUINELY fresh process (confirmed via the socket-holder check above)
  correctly triggered the real restore (`[Restore] Downloaded ... from R2`) on next login.
  **Lesson: after any backend restart tied to a data-recovery action, confirm the NEW
  PID holds the socket before declaring it fixed, and check the log for the actual
  `[Restore] Downloaded` line, not just a 200 health check.**
- **Multi-container QA on the SAME dev account ⇒ recurring `stale_baseline` CAS
  conflicts are CONFIRMED REAL this session** (both T5215 and T6630 wrote to
  `imankh@gmail.com` concurrently for hours). Symptom: `[sync] state -> conflict` console
  log, `reason: "stale_baseline"`, "A newer version of your work exists." Recovery is
  container-scoped (each container has its own LOCAL `/workspace/user_data/` cache over
  the SAME remote account) — wiping one container's local cache doesn't affect the
  other's, but see the orphaned-process landmine above before trusting the recovery
  worked.
- **Test scope discipline was violated this session and made rounds take much longer
  than necessary.** Briefs said "run the e2e suite" without qualifying it; workers
  interpreted that as running every spec file, multiple times, as final verification.
  Per CLAUDE.md's Test Scope Policy: **local runs are a curated relevant set (~10 tests),
  never a full suite — that's what Branch CI is for.** Next session: word briefs
  explicitly ("run only `<specific spec files>` + the directly-touched unit tests, do
  NOT run the full multi-file suite repeatedly").
- **`gh run watch --exit-status`'s background-task exit code is not proof of green CI.**
  This session trusted it once and almost merged on red CI. Always follow up with
  `gh run view <id>` and read the actual JOBS list / X marks — the watch command's own
  exit status reflects the watch invocation, cross-check the real conclusion.
- Container backends must run with `--reload` (several rounds this session found a
  backend started without it, serving hours-stale code) and Vite must be restarted
  (watcher unreliable) + curl-verified with a real code TOKEN (not a comment — esbuild
  strips those) before handing a port to the user.

---

## 7. NEXT, IN ORDER

1. Check T5215's round 8 (CI fix) — read `/tmp/round8.output` in `reel-task-t5215`,
   confirm both failures resolved/explained, push, watch CI **properly** (§6), merge,
   delete branch.
2. T6630: restart servers, curl-verify, hand :5175 to the user for round-7 testing.
3. Once T5215 merges: renumber T6630's v039 migration above the new head (§3).
4. **T5220 (prepend the intro at every playback/export egress) is still the epic's
   missing end** — confirmed again this session via live user testing ("why don't I see
   the intro when I play the reel"). Nothing built so far actually plays anywhere until
   T5220 ships. This is the natural next task once T5215 + T6630 are both merged.
5. T6650 (card-delete destroys profile intro photo) is filed, unstarted, not touched
   this session — see the -B handoff §5 for full context if picking it up.

**Kickoff prompt for a fresh session:**
> Read docs/plans/tasks/player-intro/SESSION-HANDOFF-2026-08-07-C.md and continue driving
> the two containers. Check T5215's CI-fix round first (§2), then T6630 (§3). Read §6
> before touching backend processes or trusting a poll/health-check.
