# T13820: Playwright sync QA: drive every finished-state gesture, assert every listening surface and the DB agree, file a task per desync

**Status:** STAGING (suite + seam merged in #661; remaining scenarios S1,S3,S7,S8,S10,S11,S9b moved to T13890)
**Impact:** 9
**Complexity:** 6
**Tier:** L (new e2e suite + one test seam; many surfaces; produces bug tasks, not fixes)
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md
**Blocked by:** T13810 (uses `window.__syncCheck`, `window.__syncTrace.entries()`, `GET /api/qa/sync-state`, and the `[STATE]` log lines)

## Why

The user's 2026-10-27 staging QA could not reproduce the desyncs it kept hitting: a Finished badge over an empty list, a badge dropping to 0 on Finish, Annotate saying "Finished" for a highlight Finished did not show. The architecture is write-to-server, write-back-to-store, UI bound to the store. The code-expert audit (2026-10-28) found the places where that paradigm is bypassed: component-held copies (`useAnnotate` highlight instances, `useCollections` state, `useDownloads.count`), holders no gesture refreshes (`gamesDataStore.games[].reel_count`), markers never cleared (`justPublished`), and a restore that commits half its change before it can fail. This task turns that audit into a repeatable Playwright run over the most sensitive synced items: state several surfaces listen to, directly or derived. Its output is evidence and filed tasks. Fixes land as separate M tasks at the top of PLAN.md (bugs before features). Keep the suite in the repo as the regression net for those fixes.

## The sensitive items (each has 3+ listeners)

| State | Listeners (surface -> holder it reads) |
|---|---|
| A project's published-ness (`final_videos.published_at` on any version) | Finished badge -> `galleryStore.count`; Finished tile -> `useCollections.members`; Just-finished card -> `galleryStore.justPublished` + members; Clips tab presence -> `projectsStore.projects` (archived projects are absent); DraftTile "ready to publish" vs "Finished" -> `project.is_published`; Annotate per-play card -> `clipRegions[].highlightInstances[].isPublished` (copy); Finished-viewer `alreadyPublished` snapshot; Re-edit button -> reel snapshot |
| A game's highlight count (`reel_count`) | Game card -> `gamesDataStore.games` (never refreshed by publish/restore/delete/move); Finished group header -> `useCollections.summary`; Rankings pool size -> `ConfidenceBanner refreshKey` |
| A play's active draft (`raw_clips.auto_project_id`, `projects.is_auto_created`) | Clips tab group (auto vs "Legacy reels", `ProjectManager.jsx:657,662`); Annotate instances (`clips.py:1333,1343`); Annotate -> Framing navigation guard (`AnnotateScreen.jsx:244-246`) |
| Export in flight (`exportStore.activeExports`) | Annotate card "In progress"; Clips draft stage; progress card; Finished badge after WS complete (`useDownloads.js:427`) |
| Which project is open (`projectsStore.selectedProject`, a copy `fetchProjects` never updates) | Framing/Overlay header; mode-switch dialogs; Annotate tab enablement (`App.jsx:679`) |

## Scenario matrix

Run every scenario on `chromium` and `iphone` (the mobile Plays drawer and Finished layout differ). After EVERY gesture: wait for network idle, read the UI assertions below, call `window.__syncCheck({projectId, rawClipId, gameId})`, assert zero mismatches, and capture evidence either way. Then navigate to each OTHER listening screen (Home Finished tab, Home Clips tab, Games, Annotate for that play, the open editor header) WITHOUT reloading and assert again; then reload and assert the same, so "stale until reload" is distinguished from "wrong in the DB".

| # | Scenario (gesture sequence) | Surfaces that must agree after each step | Known hypotheses to confirm (from the audit) |
|---|---|---|---|
| S1 | Make highlight (Portrait) on a play -> Frame -> Finish | badge +1, tile present, Just-finished card, Clips loses the draft, Annotate card "Finished / View Highlight", game card count +1, Finished group header count | `reel_count` stale on the game card (`GameTile.jsx:109-115`); Annotate copy stale if Annotate stays mounted |
| S2 | S1 then Open as Draft from the tile menu | badge -1, tile gone, Just-finished card gone, Clips shows the draft in the PLAY's group (not "Legacy reels"), Annotate card back to Frame/Resume, game count -1 | `justPublished` not cleared (`galleryStore.js:36`); `reel_count` stale; the restored project's `is_auto_created` (`projects.py:460-462`) |
| S3 | S2 then Finish again | exactly one published version; Annotate and Gallery agree; badge back to +1; no duplicate tile | version mismatch (any-version `is_published` vs latest-version counts) |
| S4 | S1 then delete the highlight from the tile menu | badge -1 (today it reads `galleryStore.count`, which delete never refreshes, `PublishedReelsPanel.jsx:476-484`), tile gone, group count, game count, Annotate card (define expected: the project is archived with no final video; record actual and flag as product question if the card is ambiguous) | badge stale; `reel_count` stale |
| S5 | S1 then move the highlight to a second profile, then switch profiles | source badge/tile/game count down; target up; Annotate in the source profile | `reel_count` stale both sides; `projectsStore` not refetched |
| S6 | Make highlights for BOTH orientations on one play; Finish Portrait; Open as Draft Portrait; Finish Landscape; Open as Draft Landscape | each slot shows its own state; Clips groups both drafts under the play; `auto_project_id` points at a sane draft | the single `auto_project_id` pointer misclassifying the older restored highlight as non-auto (`games.py:2730-2738`) |
| S7 | Start an export, keep Annotate mounted (same tab, navigate Annotate -> Framing -> export -> back to Annotate before completion) | Annotate card "In progress" -> correct final stage without reload; Clips stage; badge unchanged (export does not publish) | export-complete subscription path (`AnnotateContainer.jsx:915-937`) |
| S8 | Export fails (test seam `sync-fault` or kill the render) | no ghost "In progress"; Clips stage reverts; badge unchanged | `failExport` path |
| S9 | Open as Draft while the restore fails: 503 via `sync-fault`, and 404 archive-missing (seam needed; see below) | UI unchanged and consistent on 503; on 404 the DB must not be half-changed (today `published_at` is nulled at `downloads.py:2654` before the archive restore at `:2671`) | half-applied restore; client does not refresh on non-ok (`useReEditReel.js:53-70`) |
| S10 | Finish, then open the Rankings/Confidence banner | pool size reflects the new highlight (own-layer) or excludes it (Team layer, T11160) | `refreshKey` only bumps on re-rank/move |
| S11 | With a project open in Framing, publish or delete it from another surface reachable without closing (if any), then read the header and mode-switch dialog | `selectedProject` copy vs `projectsStore.projects` | copy never updated (`projectsStore.js:27`) |
| S12 | Shared-in Team clip (set `raw_clips.shared_by`, `my_athlete = 0`): S1 and S2 | identical to S1/S2 (T13790 regression) plus Rankings exclusion | T13790 regression |

## Environment and fixtures

- Run against the task container's local stack (dev-login on the user's own account kicks their session; never automate on the account the user is testing). Use a dedicated e2e account created by `POST /api/auth/test-login` with `X-Test-Mode` (pattern: `e2e/T11990-finished-viewer-close-landing.qa.spec.js:32-48`), or `loginAsRealUser` from `e2e/helpers/realAuth.js` against a seeded fixture account.
- **New test seam, required:** `POST /api/test/seed-published-highlight` beside `seed-final-video` (`routers/test_seams.py`): creates game + raw clip (+ optional `shared_by`/`my_athlete`) + auto project (`source_raw_clip_id`, `raw_clips.auto_project_id`) + a `final_videos` row (published or not, with a real small mp4 in storage so the viewer and delete paths work) and returns all ids. The existing `seed-final-video` inserts `project_id` NULL, so it cannot exercise restore. S1 (the real render) runs once per browser project through the real pipeline (local FFmpeg); every other scenario starts from the seam so the matrix stays under ~15 minutes. Gate it exactly like the other seams (`_test_seams_enabled`).
- A second seam or a parameter for the S9 404 case: archive object missing for a published project.
- Server truth per assertion: `GET /api/qa/sync-state` (T13810) and the existing lists (`/api/downloads/count`, `/api/projects`, `/api/games`, `/api/collections/summary`, `/api/clips/raw/{id}/highlight-instances`) via `context.request` with `X-Profile-ID` (pattern: `e2e/T4110-reedit-reel-persistence.spec.js:85-87`).
- Backend log: tee uvicorn to a file; on mismatch, pull `[STATE]` and `[REQ]` lines for the request ids in the trace with `reduce_log` (never read raw).

## Evidence and filing protocol (the point of the task)

For each scenario x device x step, save under `qa/sync/<scenario>/<device>/<step>/`: screenshot, `__syncCheck` report JSON, `__syncTrace.entries()` JSON, the server probe JSON, and the matching backend log lines. A mismatch is a FINDING, not a test failure to fix in this task:

1. Reproduce it once more in isolation (fresh seam state) to rule out ordering.
2. Classify: (a) holder never refreshed by this gesture, (b) holder is a copy of a store, (c) marker not cleared, (d) DB half-change / wrong server answer, (e) derivation disagreement (client stage vs server stage), (f) race (correct after a short wait: report the wait).
3. File `docs/plans/tasks/T<id>-<slug>.md` (next free ids from T13830; check `origin/master` first, another session may have taken them) with: the scenario and step, both screenshots (before/after reload), the `__syncCheck` row naming holder / client value / server value / last refresh (reason, reqId, age) / newer write, the `[STATE]` line, the audit's file:line for the holder, Impact/Complexity, and a one-paragraph fix direction that stays inside the paradigm (refresh in the gesture handler, or subscribe the copy to the store; never a `useEffect` that persists). Insert the row at the top of the bugs section in PLAN.md, M tier, with `Blocked by` empty.
4. The spec for that scenario stays in the suite marked `test.fixme('<T-id>')` with the assertion intact, so landing the fix flips it green.

Pre-filed candidates the matrix must either confirm with evidence or clear: game-card `reel_count` after publish/restore/delete/move (S1, S2, S4, S5); Finished badge after delete (S4); `justPublished` after restore (S2); failed-restore no-refresh and half-applied restore (S9); `is_auto_created` after restore of the older of two highlights (S6); Annotate copy while mounted (S1, S7); `selectedProject` copy (S11).

## Non-goals

- Fixing anything found (file it). Exception: a one-line test-seam or spec bug in this task's own code.
- Staging or prod runs (the suite is local; the user re-walks staging by hand after the fixes land).
- Visual polish assertions.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/e2e/sync/*.sync.spec.js` (new, one file per scenario group S1-S3, S4-S5, S6, S7-S8, S9, S10-S12), `src/frontend/e2e/helpers/syncCheck.js` (new: wraps `__syncCheck`, probe fetch, evidence saving via `helpers/qa.js saveEvidence`)
- `src/frontend/playwright.config.js` (a `sync` project or tag; chromium + iphone only)
- `src/backend/app/routers/test_seams.py` (`seed-published-highlight`, archive-missing parameter) + `src/backend/tests/test_t13820_seed_published_highlight.py`
- `docs/plans/tasks/T138x0-*.md` and `docs/plans/PLAN.md` (filed findings)
- Read-only references: `src/frontend/src/modes/annotate/clipStage.js`, `src/frontend/src/utils/draftStage.js`, `src/frontend/src/hooks/useCollections.js`, `src/frontend/src/stores/galleryStore.js`, `src/frontend/src/stores/gamesDataStore.js`, `src/frontend/src/containers/AnnotateContainer.jsx`, `src/backend/app/routers/downloads.py` (publish `:2410`, restore `:2600`, delete `:1364`, move `:1905`)

### Related Tasks
- Blocked by T13810 (instrumentation it consumes)
- T13790, T13800, T13780 (the incidents); T4110 (existing re-edit e2e, extend rather than duplicate its helpers), T4850 (move e2e, `seed-final-video`), T11160 (Team-layer rankings rule), T10070

### Knowledge docs
- `.claude/knowledge/annotate.md` (clipStage, highlight instances, Annotate remount assumption at `AnnotateContainer.jsx:913-914`), `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/persistence-sync.md`. Add a "sync QA suite" section at Stage 7: how to run it, the scenario ids, the filing protocol.

### Technical Notes
- One scenario per spec `test()`; `test.describe.serial` only inside a scenario. Each spec seeds its own state through the seam and never depends on another spec's leftovers.
- Branch CI never runs Playwright (`src/frontend/e2e/**`); this suite runs from the container (`npx playwright test e2e/sync --project=chromium --project=iphone`) and its evidence is attached to the filed tasks. Record the command, exit code and HEAD in `qa/proof.json` as this task's evidence.
- Assert through user-visible text and roles (badge number, "Finished / View Highlight", "Make highlight", tile presence) AND through `__syncCheck`; the pair is what distinguishes "UI wrong" from "store wrong".
- Design gate: a short `T13820-design.md` fixing the seam's payload shape, the spec file layout, and the exact wait strategy after a gesture (network idle + the trace's `fetch` entry for the expected holders, not a sleep). Then implement.

## Implementation

### Steps
1. [ ] Design doc (seam payload, layout, wait strategy); approval
2. [ ] `seed-published-highlight` seam + archive-missing parameter + backend test
3. [ ] `helpers/syncCheck.js`; S1 real-render spec on chromium; confirm the harness end to end (seed -> gesture -> `__syncCheck` -> evidence)
4. [ ] S2-S12 specs, chromium then iphone
5. [ ] Run the matrix; for each mismatch follow the filing protocol; `test.fixme` with the task id
6. [ ] Summary table scenario x device x surface -> pass / filed T-id in this file's Progress Log; knowledge doc section; curated tests + lint; review on the diff

### Progress Log

**2026-10-28**: Filed from the code-expert sync audit; blocked on T13810.

**2026-10-28 (run)**: `npx playwright test e2e/sync --project=chromium --project=iphone-sync --workers=1` -> 10 passed, 10 skipped (fixme), exit 0, ~24 min.

| Scenario | chromium | iphone-sync | Result |
|---|---|---|---|
| S2 restore | ran | ran | T13850 (game card reel_count), rest clean |
| S4 delete | ran | ran | T13860 (badge), T13850 |
| S5 move | ran | ran | T13850 only; target side clean (cleared) |
| S6 two orientations | ran | ran | T13880, T13850 |
| S9 failed restore | fixme | fixme | T13870 (503 observed; 404 by code, not observed) |
| S12 shared-in | ran | ran | T13850 only (T13790 regression clean) |
| S1, S3, S7, S8, S10, S11 | not run | not run | not covered: need real render / export UI not driven yet |

Pre-filed candidates: reel_count confirmed (T13850); badge after delete confirmed (T13860); failed-restore half-apply confirmed on 503 (T13870); is_auto_created confirmed (T13880); justPublished after restore cleared in S2 (no mismatch); selectedProject copy and Annotate-copy-while-mounted untested (S11, S1, S7).

## Acceptance Criteria

- [ ] Every scenario S1-S12 runs on chromium and iphone from the seam (S1 through the real pipeline once per device) in one command, under ~15 minutes
- [ ] Every gesture step asserts UI text AND `__syncCheck` AND the server probe, before and after reload
- [ ] Each mismatch is filed as its own task with the attribution row, screenshots, `[STATE]` line and fix direction, at the top of the bugs section; its spec is `test.fixme('<T-id>')` with the assertion intact
- [ ] The pre-filed candidates are each either confirmed (task filed) or cleared (evidence saved)
- [ ] The suite and seam are committed and documented; the run's command, exit code and HEAD are in `qa/proof.json`
