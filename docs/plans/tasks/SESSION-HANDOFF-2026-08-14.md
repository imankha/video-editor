# Session handoff — 2026-08-14

**master @ `79a7e646`.** Read this before doing anything else in a fresh session — it is fully
self-contained. A `/dotask` wave of 6 tasks ran today; 5 landed on master (staging
auto-deployed), 1 is still mid-flight in a live container, and staging testing surfaced 2 new
real bugs on just-merged features that need fixing before a prod deploy makes sense.

## What shipped today (all merged to master, staging auto-deployed)

| Task | What | Notes |
|------|------|-------|
| T6990 | Overlay text fades out over its final 0.25s instead of hard-cutting (both burn loops + editor preview) | Modal redeployed (`reel-ballers-video-v2`) same day, user-approved. CI green. |
| T6890 | Rename/edit pencil repositioned next to the name on DraftTile/ReelTile/GameTile | Positioning-only, no behavior change. CI green. |
| T4945 | Collection download — stitch member reels into one MP4 with intro/outro | CI red on the same unrelated pre-existing failure as T6990 (T7000, see below), attributed not blocking. **See T7040 below — this endpoint is broken on first real staging use.** |
| T7010 | Investigated a "couldn't save" clip error + apparent game-misattribution report | Resolved as **no bug** — real CAS sync conflict (known multi-container-QA-on-one-account collision) that auto-healed; the misattribution "mystery" resolved once the user confirmed they were promoting OLD previously-rated clips (2026-06-11 session) into reels, not annotating live. Logging improvements merged regardless (frontend-believed game id at save time, CRITICAL log on mid-write DB heal). |
| T6820 | Hover preview for Not Started drafts (source clip window) + generalized the reveal-delay policy | Reveal now fires at `max(~450ms floor, real content-load-ready time)` for ALL preview tiers (not just this one) — driven by the video's actual `loadeddata` event, never padding past real load time. User confirmed the ~4s delay they saw afterward is genuinely unavoidable latency (source video's `moov` atom isn't at the front — see T7020). |

**Decision made today**: Collection downloads stay **free** (not charged). Built a margin
calculator from confirmed codebase pricing (credit packs, 1 credit/sec) + the actual compute
shape of a collection download (CPU-only Modal stitch, zero R2 egress fees) — a user downloading
every collection they have costs well under 1 percentage point of margin. This unblocked T4946
(shrinks to permission+sign-in only, no credit machinery) and simplified T4947 (drops the
now-moot credit-recharge-exemption scope). See `tasks/collection-download/EPIC.md` Decision 4.

## STILL IN FLIGHT — T6980 (double-click inline text edit)

**Not pushed. Container `reel-task-t6980` is still up, do not nuke it.**

- Design approved by the user earlier today (transparent `<input>` overlay, Escape=commit,
  desktop-touch two-tap all OK) — `docs/plans/tasks/T6980-design.md` in that container's
  checkout has the full design.
- Implementation is **committed** at `d9bd4124` on branch
  `feature/T6980-overlay-double-click-text-inline-edit` (12 files, unit 91/91 green, e2e 9/9
  green + T6720/T6880 regression green, lint clean). Found and fixed one real bug along the way
  (missing `hasTouch`/`isMobile` Playwright test.use() config for the touch double-tap e2e
  cases — precedent T5644/T5225/T5647/T6610).
- A **fresh-context reviewer was spawned in the background** on commit `d9bd4124` (focused on
  dblclick hit-test/two-tap edge cases, the single-write-path rule, both keyboard-guard sites,
  React effect correctness, T6880 gating) and returned findings. **The fix pass for those
  findings is UNCOMMITTED** — `git status` in that container shows modified (not committed):
  `TextManagementPanel.jsx`, `TextSpecEditor.jsx`, the e2e qa spec, and
  `textpreviewdiag/main.jsx`. Nothing has progressed past this point for a while — the worker's
  own turn ended without finishing (twice — once mid-review-fix, once apparently waiting on a
  synchronous Playwright run it didn't actually block on).

**To resume**: `docker exec -u dev reel-task-t6980 bash -lc 'cd /workspace && git diff'` to see
exactly what's pending, then drive it via `claude -p -c` (or fresh-seed if the container's been
idle a while — check `.dotask-status` last-line age) with an instruction to finish applying the
reviewer's fixes, re-run the affected tests, commit (message starts `T6980:`, explicit `git add`
of only the touched paths — `.dotask-status` is intentionally excluded from every commit on this
branch, see that file's own first line), then the mandatory real-browser QA phase, then
`PUSHREADY`. Once it reports `PUSHREADY <branch> <sha>`: sanity-check the diffstat, `bash
scripts/task.sh push t6980`, poll `gh run list --workflow "Branch CI" --branch
feature/T6980-overlay-double-click-text-inline-edit`, then merge the same way every other task
merged today (`git fetch origin`, `git merge --no-ff origin/feature/T6980-...`, push, flip
PLAN.md status to STAGING, delete the WAVE.md row).

`.dotask-status` in that container was reset locally early in its life (see its own first line)
because `.dotask-status` used to be **accidentally tracked in git** — that's fixed now
(untracked + gitignored, commit `0da9a40c` today), so this won't recur for future spawns.

## NEW BUGS found while testing today's merges on staging (not yet started)

Both filed as tasks with full evidence — read the task files, this is just the index:

- **T7040 — Collection download fails with "TypeError: Failed to fetch"**
  (`tasks/T7040-collection-download-failed-to-fetch.md`). T4945's brand-new endpoint, broken on
  its first real use. CORS preflight succeeds cleanly; the actual GET never resolves. Ruled out
  "Modal function never deployed" (it hydrates fine on the live app). Leading hypothesis: an
  exception mid-stream, after the `StreamingResponse`'s headers are already committed to a 200 —
  the browser reports a generic network error in exactly that scenario, not a clean HTTP status.
  **Needs live server-log tailing during a real repro** — retrospective log capture (what this
  investigation tried first) was inconclusive; staging has enough concurrent traffic that a
  short capture window easily misses the moment. **Recommend fixing before considering T4945
  actually done**, even though it's already merged.
- **T7030 — Intro card image doesn't load; scrubbing back leaves the video blank**
  (`tasks/T7030-intro-card-image-scrub-back-blank.md`). HAR evidence: `/downloads/{id}/stream`
  404s on a retry immediately after the first attempt is client-cancelled (matches "video stops
  blank" on scrub-back). Separately, NO intro-image network request fires at all when scrubbing
  back into the intro segment — points at a stale-mount bug, not a fetch failure, for the image
  half. Same component family as several prior bugs today's session didn't touch (T6710/T6730/
  T6860/T6870 — `CompositeScrubber`/`IntroStoryPlayer`/`MotionPreview`/`useIntroPlayback`).

## Other open tickets filed today (lower priority, not blocking)

- **T7000** — a pre-existing, unrelated backend test (`test_js_path_raises_clear_error_at_
  fly_image_depth`) fails on Master CI itself and on every branch's Branch CI (hit it 3x today:
  T6990, T4945, T6820) — already documented in `docs/testing/known-failures.md`, safe to keep
  ignoring per-PR, but the underlying T6920 guard regression should get root-caused eventually.
- **T7020** — uploaded game videos never get a `faststart` remux (`moov` atom stays wherever the
  source device wrote it, often the END of the file), costing 4-5 sequential R2 round trips on
  every seek into raw game footage (hover previews, Annotate scrubbing, bounded clip-stream).
  Lossless `-c copy -movflags +faststart` at upload finalize would collapse this to 1-2 round
  trips for NEW uploads. No backfill of existing videos in scope.

## Path to a prod deploy

Once T6980 lands and — strongly recommended — T7040 is at least understood/fixed (a broken
"Download" button on a feature that just shipped is a bad first impression to carry into prod),
run the normal `/deploy` flow (see `.claude/skills/deploy/SKILL.md`): it auto-promotes every
task whose implementation is in the deploy to DONE and archives PLAN.md rows. T7030 is
playback-only (no data risk) and could reasonably ship after, as its own follow-up, if you want
to deploy sooner — that's a product call, not a technical blocker.

## Bookkeeping fixed today, FYI

- `.dotask-status` was accidentally tracked in git (50KB+ of unrelated prior-task history
  inherited by every new `/dotask` container clone) — untracked + gitignored, commit `0da9a40c`.
- One `git add docs/plans/PLAN.md` today swept in an unrelated PLAN.md reorganization you'd made
  via the task-board tool in a separate window — you confirmed that was expected, no action
  needed, just noting it happened in case the history looks like a bigger diff than one task
  warrants.
