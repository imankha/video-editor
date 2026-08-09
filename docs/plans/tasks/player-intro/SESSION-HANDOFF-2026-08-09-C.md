# Session handoff — 2026-08-09 (C) ~23:15 UTC. Supersedes SESSION-HANDOFF-2026-08-09-B.md

**master @ `e8105fa9`** (plus a docs-only commit after this file). T6680+T6700 merged this
session (default/inherit removal + owner in-app playback intro) — the -B handoff's "2 workers
in flight" is now done. `C:/work/tasks/WAVE.md` is the live source of truth — read it first;
this file adds only what WAVE.md doesn't carry (narrative + landmines + what's next).

**User has a list of fixes/feedback to give at the start of the next session — let them lead.**

## 1. Cold-start bootstrap (do this first, ~3k tokens)
1. Read `C:/work/tasks/WAVE.md` in full (short, current).
2. `docker ps --filter name=reel-task` — confirm which containers are still up.
3. Tail `C:/work/tasks/t6640/.dotask-status` and `C:/work/tasks/t6710/.dotask-status` +
   `git -C /c/work/tasks/t6710 log --oneline -5`.

## 2. T6640 (`reel-task-t6640`, :5179/:8006) — PUSHED, waiting on user test
Branch `feature/T6640-cards-cannot-be-ugly`, head `88331b08`. Fixed the intro-card title/fact
text overlap (frontend preview measured text-wrap differently than the backend's PIL renderer;
backend now emits pre-broken lines, frontend renders them verbatim). Branch CI green
(changes/frontend/backend all `success`). Servers were stopped when last checked — **restart
before handing to the user again**: `docker exec reel-task-t6640` — kill any stale
uvicorn/vite, verify the port is free via `/proc/net/tcp` (hex `1F40`=8000), then
`nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000` (backend) and
`nohup npx vite --host 0.0.0.0 --port 5173` (frontend). Test link + steps already given to the
user this session — see chat history if needed, or re-derive from the task's acceptance
criteria in `docs/plans/tasks/player-intro/T6640-cards-cannot-be-ugly.md`.

**This is a free WIP slot per dotask's own rule** ("a slot frees when a branch is PUSHED and
handed to the user") — T6650 or T6670 (both queued, see WAVE.md) could be dispatched now if
the user wants more parallel work; not yet done as of this handoff.

## 3. T6710 (`reel-task-t6710`, :5180/:8007) — mid Stage-4 implementation
Branch `feature/T6710-owner-playback-intro-as-timeline-segment`. **Went through 3 rounds of
design revision this session — read `docs/plans/tasks/T6710-design.md` for the final
decision-complete version, not the task file's original framing.** Key facts so the next
session doesn't re-derive them:
- Extends the NOW-MERGED T6700 code (swap in `DownloadsPanel.jsx`, both `intro-playback` GET
  endpoints) — does NOT rebuild it. An earlier round designed a from-scratch rebuild before
  T6680+T6700 were merged to master; that was corrected mid-session.
- User decisions (override the worker's original recommendations, already baked into the
  approved design): intro region + EVERY reel segment sized PROPORTIONALLY to actual duration
  (not equal-weight); TRUE arbitrary seek within the intro (not restart-only) — `MotionPreview`
  becomes `currentTime`-driven instead of `setTimeout`-driven.
- Scope explicitly includes `SharedCollectionView` (the public share page) — the proportional
  segment-bar change flows through globally, not gated per-caller. This was a deliberate,
  approved scope expansion (caller-impact check surfaced it, user chose "apply everywhere").
- `useStoryPlayback`/`CollectionPlayer`'s core hook stays byte-identical; a new
  `IntroStoryPlayer` composite + `useIntroPlayback` clock + `CompositeScrubber` are additive.
- Last status (22:15 UTC): Stage 3 tests written (6 files, RED for the right reason), entering
  Stage 4. **Resume pattern** (fresh-seed if last activity >~1h old):
  ```
  docker exec -d -u dev reel-task-t6710 bash -lc 'cd /workspace && claude -p --model sonnet "Read /workspace/.dotask-kickoff.md and /workspace/.dotask-status. Continue Stage 4 implementation from the last STAGE_DONE line — the design (docs/plans/tasks/T6710-design.md) and failing tests are the spec. Append status lines; final act is PUSHREADY <branch> <sha> or BLOCKED." > /tmp/round5.output 2>&1'
  ```
- Two invented test seams flagged by the Tester for Stage-4 review: `IntroStoryPlayer`'s
  test-only `__captureOnScrub` prop, and the concrete `CompositeScrubber` component/prop names
  (design left these open) — sanity-check these got resolved cleanly, not left as debug scaffolding.

## 4. T6650 + T6670 — queued, not yet spawned
Both TODO, both ready (M-tier, no design gate expected), both file-disjoint from T6640/T6710
and from each other. WIP=2 cap (see §5) is why they haven't started. Task files:
`docs/plans/tasks/player-intro/T6650-card-delete-destroys-profile-intro-photo.md` (real
data-loss bug — card delete can destroy the profile's shared intro photo) and
`T6670-card-selector-inline-create-flow.md`.

**T6690 stays excluded from new dispatch** — last checked, the SHARED main tree
(`c:\Users\imank\projects\video-editor`, not a container) had uncommitted changes to
`ManageProfilesModal.jsx` + a new `ManageProfilesModal.T6690.test.jsx`, suggesting a concurrent
session may already be working it live. Check `git status` in the main tree before assuming
it's safe to pick up.

## 5. Landmines confirmed this session (do not re-derive)
- **The shared main tree can be badly stale.** Early this session, extensive work was done
  reconstructing an "epic consolidation" (folding overlay-text/card-editor tasks into the
  Player Intro epic) believing it was lost — it turned out a concurrent session had ALREADY
  done this and pushed it to master; the local main checkout had simply never fetched those
  commits (was 6+ commits behind `origin/master`, on a detached HEAD). **Always `git fetch
  origin master` and compare before trusting EPIC.md/PLAN.md content read from the local main
  tree** — prefer a fresh scratch clone or explicit `git show origin/master:<path>` over
  reading the working tree directly when the state matters.
- **The main tree had (and may still have) OTHER sessions' uncommitted work** — never
  `git checkout`/reset broadly there; stage explicit paths only, or better, do doc edits in an
  isolated scratch clone and push directly (pattern used successfully this session: clone to
  scratchpad, edit, commit, push to master, delete the clone when done).
- **Worker `PUSHREADY` status lines are not proof of an actual `git push`.** Both T6680 and
  T6700's workers logged `PUSHREADY` but never pushed — confirmed via `git fetch` + compare
  against origin before trusting it. Always verify.
- **Container dev servers do not survive being idle/checked-back-into** — always verify with a
  live curl before handing a test link to the user; restart clean (kill + verify port free via
  `/proc/net/tcp` + relaunch) if not responding, per the documented orphaned-child landmine.
- **A task file describing a bug's root cause can itself be stale** if a prior partial
  implementation landed without the tracking doc being updated (T6640: rounds 1-2 already
  replaced the described fixed-position layout with a measured "reflow" system; the live bug
  was a much narrower residual defect than the task file implied). Have the Code Expert stage
  verify claims against actual current code before designing a fix, don't implement the task
  file's stated root cause blindly.

## 6. Next
No new work should start without the user's list of fixes (see top). Once given: classify each
(tier, file-ownership check against T6640/T6710/T6650/T6670's files), then either fold into an
existing in-flight branch (if same files) or queue/spawn fresh per WIP=2 (user's explicit
preference this session, after the 2026-08-06 3-wide-parallel burn incident — see
`.claude/skills/dotask/SKILL.md`).

**Kickoff prompt for a fresh session:**
> Read docs/plans/tasks/player-intro/SESSION-HANDOFF-2026-08-09.md, then let me give you my
> list of fixes before starting anything new.
