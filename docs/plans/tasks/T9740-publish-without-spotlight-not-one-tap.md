# T9740: "Publish without spotlight" doesn't publish in one tap

**Status:** STAGING — fix v3 merged (PR #419). **4th attempt; live-staging AC2 re-verification STILL REQUIRED and NOT yet done.**
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-12
**Updated:** 2026-09-12

## ⚠ Fix v3 (FOURTH attempt) implemented on `feature/T9740-publish-without-spotlight-fix-v3` — see "Resolution — Fix v3" below. LIVE-STAGING RE-VERIFICATION STILL REQUIRED (three prior rounds all passed their own tests then failed live).

## ⚠ Fix v2 narrowed the bug but did NOT close it — 3rd live-staging round FAILED, 4th round pending expert consult

**2026-09-12, current status.** Fix v2 (merged, PR #418) genuinely fixed the ref-sharing bug: the
auto-triggered export now correctly hits `/api/export/render-overlay`, completes successfully, and
produces a real `final_video` with zero waste. **But the publish call itself never auto-fires** -
the user still needs one manual "Publish" click on the resulting "Ready to Publish" card. See
"Staging Verification — Fix v2" near the end of this file for full evidence (network log confirms
`/api/downloads/publish/7` never fires; neither of Fix v2's own new failure-signal branches
(`onAbandon`, the wrong-mode assertion) fired either - meaning the render pipeline is now fully
correct and the gap is specifically downstream, in the auto-publish handoff itself).

**Leading hypothesis for the 4th attempt** (not yet confirmed - hand to the expert agent to verify):
`App.jsx`'s `handleExportComplete` (~line 625-628) gates the auto-publish branch on THREE
conditions: `completed.mode === OVERLAY`, a freshly-read `currentMode === OVERLAY`, AND
`completed.projectId === currentProjectId` where `currentProjectId` comes from
`useProjectsStore.getState().selectedProjectId` - NOT from the publish-intent stake. In the
"Publish without spotlight" one-tap flow, the project was never explicitly "selected" via normal
navigation (the user clicked a dialog button, `scheduleOverlayPublishExport` fired the render
programmatically) - so `selectedProjectId` may simply not equal the staked project, and the whole
auto-publish branch never gets entered, regardless of the publish-intent stake being perfectly
correct. If true, gating on the publish-intent stake's own `projectId` (which IS reliably set) rather
than requiring `selectedProjectId` to independently match would be the more surgical fix - but this
needs verification against how `selectedProjectId` actually behaves in this specific flow, not
another guess.

**Per user decision 2026-09-12: proceed with one more expert consult + 4th fix attempt** (not
parking this task). Net progress across 3 rounds: 3 manual gestures (original) -> 2 wasted + stranded
(v1) -> 1 manual click (v2, current). Do not re-promote past WIP until a 4th round achieves a
genuine zero-click PASS on live staging.

## ⚠ SUPERSEDED — Fix v2 STAGING banner (kept for history, do not re-read as current status)

Fix v2 merged and briefly sat at STAGING pending its 3rd live-verification round, which came back
FAIL (see above) - status corrected back to WIP.

**2026-09-12, superseding the "CONFIRMED REGRESSION" banner below.** A second expert-agent (Opus)
consult identified the real, deterministic mechanism: `App.jsx` handed ONE `exportButtonRef` to
BOTH Focus's and Overlay's export buttons, so a readiness poll checking only `!!ref.current` was
satisfied on tick zero by whichever button happened to still be mounted (always Focus's, during the
transition) — this reproduced 100%, not intermittently, and no amount of "waiting smarter" (the v1
fix's approach) could have found it, since the ref itself carried no identity. **Fix: split into
`focusExportButtonRef`/`overlayExportButtonRef`** so the poll is satisfied by construction only once
Overlay's own button exists. Full mechanism, rejected alternatives (notably: gating on
`editorMode === OVERLAY` is ALSO provably broken — investigated and explicitly rejected, not just
untried), and test evidence are in "Resolution — Fix v2" below.

**Independently re-verified by the supervisor session** (not taken on the implementer's word, given
two prior "tests pass" rounds both failed live): genuine red on the pre-fix commit (4 tests fail
exactly on `scheduleOverlayPublishExport is not a function`), genuine green after
restore (39/39), the provably-broken `editorMode` gate pattern grepped absent from the diff, the two
refs confirmed as genuinely separate objects, `handleAddSpotlight` confirmed untouched, lint 0
errors, build clean. Branch CI failure was the already-documented pre-existing
`uploadManager.attachVideo.test.js` flake (`known-failures.md` row 30, this diff never touches
`uploadManager.js`) — merged per this project's merge-when-provably-verified policy.

**Still NOT closed**: this is the THIRD attempt at this acceptance criterion. The first two both
passed their own test suites and then failed live on staging (the exact class of bug — real
Modal-render timing / React mount ordering — that a dev-container sandbox cannot reproduce). **A
live-staging re-verification pass is running now; do not treat this task as done, and do not
re-promote it past STAGING, until that lands with a PASS.**

## ⚠ SUPERSEDED — v1 regression record (kept for history, do not re-read as current status)

**2026-09-12 live staging re-drive found the merged fix (PR #417, `0e9ae01f`) does NOT deliver
one-tap publish, and is arguably worse than the original bug.** The specific race originally
diagnosed (`exportButtonRef` null at the 500ms mark) is genuinely fixed — the scheduled poll now
reliably finds a non-null ref. But it finds the WRONG ref: `scheduleExportWhenReady`'s first
readiness check runs SYNCHRONOUSLY on the same tick as the click, before React has even processed
the `setEditorMode('overlay')` state change — so it fires against Focus's own still-mounted export
button (the "Generate AI Focus" control, which shares the same ref) instead of waiting for
Overlay's. This silently POSTs to the FRAMING render endpoint (`/api/export/render`) instead of the
overlay one (`/api/export/render-overlay`), **burning a real ~90s render** that produces a
`working_video` update with no `final_video_id`, then the UI silently reverts to the plain
pre-export button with no toast, no error, no completion dialog — the user is stranded on Overlay
exactly as before, just via a new mechanism that also wastes a real render. See "Staging
Verification (2026-09-12)" near the end of this file for full evidence and a code-supported
root-cause hypothesis (the ref-sharing/tick-timing mechanism, not just "still racy").

**Status set to WIP, not STAGING** — this is a confirmed, reproducible regression on the currently
merged code, not a "still unverified" gap. Per this project's model policy, a second implementation
attempt should not be another Sonnet guess: the first fix already went through an expert-agent
design consult and still missed this. **Escalate to the expert agent again with this specific
finding before attempting another fix.**

## Source

Found live on staging during T9710's verification (`docs/plans/tasks/T9710-publish-and-draft-destination-verification.md`,
section "AC2 — Publish without spotlight"). Not a privacy issue - a functional/copy contract break
on the exact button T9590 designed as the secondary one-tap publish path.

## Problem

The T9590 post-Focus dialog's **Publish without spotlight** button is captioned *"Adds it to your
Highlight Reels as is - anyone with the link can watch it"* - a one-tap promise. It does not do
that. Clicking it:

1. Navigates to `/overlay` and opens the full interactive Spotlight editor, with a highlight region
   already auto-added from AI Focus's player-detection pass - i.e. the "decline spotlight" choice
   lands the user on a screen that has already half-configured a spotlight.
2. The code's own documented one-tap mechanism never fires: `handlePublish`
   (`src/frontend/src/screens/FocusScreen.jsx:1128-1147`) calls `setEditorMode('overlay')` then
   `setTimeout(() => exportButtonRef.current?.triggerExport(), 500)` - the comment above it
   (`:1118-1127`) explicitly says *"ONE tap, TRUE publish... fires the same spotlight-less overlay
   render... App.jsx's shared export-completion handler... reads that flag when THIS project's
   render completes and auto-runs the publish gesture."* On staging, no second `/api/export/render*`
   request fired at all - confirmed by watching the network log for 90+ seconds after the click.
3. The user is left stranded on the Overlay editor with only a manual **"Export clip with effects"**
   action available - the opposite of "without spotlight" framing (it's costed/labelled as an
   effects export).
4. Manually clicking that fires `POST /api/export/render-overlay` and lands the clip in "Ready to
   Publish" - still not published.
5. A further manual **Publish** click there finally fires `POST /api/downloads/publish/{id}` and the
   clip correctly lands in Published.

**Net: 3 manual gestures instead of the promised 1, one of them through spotlight-editing UI the
user explicitly declined.** The eventual end state (published, correct link, correct audience) is
right per T9710's AC4 - this is a broken intermediate path, not a data-correctness or privacy bug.

**Contrast case confirmed working**: choosing **Add spotlight** from the same dialog (T9710 AC3)
lands directly and correctly in the Overlay editor with one clean Export -> Publish flow matching
its own copy. The bug is specific to the "decline spotlight" shortcut's auto-trigger.

## Root Cause (hypothesis, not confirmed - next task should verify before fixing)

`exportButtonRef.current?.triggerExport()` at `FocusScreen.jsx:1146` most likely resolves to
`undefined`/a stale ref at the 500ms mark - `setEditorMode('overlay')` triggers a re-render/remount
of the Overlay-mode `ExportButtonContainer` that owns `exportButtonRef`, and 500ms may not be
sufficient (or the ref may not yet be attached) once React actually swaps editor modes, versus
whatever local/dev conditions this fixed timeout was originally tuned against. Confirm with a real
repro + console/breakpoint on the ref value at the callback, don't assume this diagnosis is complete
- the QA agent explicitly could not conclusively determine why the trigger silently no-ops.

## Context

### Relevant Files
- `src/frontend/src/screens/FocusScreen.jsx:1118-1147` - `handlePublish`, the ONE-tap mechanism that
  isn't firing
- `App.jsx`'s shared export-completion handler (referenced in the comment above `handlePublish`, T8530's
  "land the user on the finished reel" block) - reads `publishIntentStore` when the render completes
  and should auto-run the publish gesture
- `publishIntentStore.js` - the cross-component signal `handlePublish` stakes before triggering
- `ExportButtonContainer` (overlay mode) - owns the ref `exportButtonRef.current.triggerExport()` is
  called on

### Related Tasks
- Found during: T9710 (verification task, no code - this is the filed follow-up)
- Introduced/owned by: T9590 (post-Focus choice hierarchy - designed this exact button and its
  one-tap promise), T8390 (original "Finish Now" -> "Publish" one-tap mechanism this reuses)

### Technical Notes
Reproduce on staging (or local dev against staging-equivalent code) with a fresh AI-Focus-completed
clip, click "Publish without spotlight" from the T9590 dialog, and watch the network tab for the
second `/api/export/render-overlay` (or `render*`) call that should fire ~500ms after entering
Overlay mode. If it doesn't fire, add logging/a breakpoint at `FocusScreen.jsx:1146` to see whether
`exportButtonRef.current` is null, or whether `triggerExport` throws/no-ops silently.

## Acceptance Criteria

- [x] Root cause of the missing auto-trigger confirmed (not just the hypothesis above)
- [ ] "Publish without spotlight" completes in one tap on both staging and local dev, matching its
      own caption - no stranding on the Overlay editor
- [x] "Add spotlight" path (T9710 AC3) continues to work exactly as it does today - no regression
- [x] Regression test added that would have caught this (the failure mode is exactly "happy path UI
      looks fine, the async auto-trigger silently no-ops" - inject/observe the actual async
      completion, don't just assert the button click doesn't throw)
- [x] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [x] Branch CI green (red only on the already-documented pre-existing `uploadManager.attachVideo.test.js`
      flake, unrelated to this diff - see `docs/testing/known-failures.md`)

## Resolution (2026-09-12)

**Confirmed root cause**: `FocusScreen.handlePublish`'s fixed `setTimeout(() => exportButtonRef.current?.triggerExport(), 500)`
raced Overlay mode's async video hydration. `workingVideo` is explicitly nulled by `FocusScreen`
(~line 1030-1032) before the overlay mount, and hydrating it again takes 2+ async fetches -
`OverlayScreen.effectiveOverlayVideoUrl` (which gates whether `OverlayExportButtonSection`, and
therefore `exportButtonRef`, mounts at all) routinely stays null past the 500ms mark, so
`exportButtonRef.current` was `null` and `triggerExport()` silently no-opped. 500ms was never a
safe margin, not a value that needed re-tuning. (StrictMode double-render and `setEditorMode`
batching timing were both investigated and ruled out.)

**Fix**: extracted a bounded readiness-poll scheduler (`src/frontend/src/utils/scheduleExportWhenReady.js`)
that waits for the export button to actually be ready before firing, using the existing
`publishIntentStore` stake as its sole stop condition (no new deadline/magic number to re-tune
later). Chosen over a reactive `useEffect` (wrong causality/edge-trigger fragility) and a new
`onReady` callback prop (over-built, new prop chain) after an Opus expert-agent design consult, per
this project's async-timing escalation policy. Reviewed by a fresh-context Reviewer: APPROVED, 0
blocking/major, 3 minor (2 applied as doc polish).

**Verification gap, needs staging confirmation**: full end-to-end live-drive of the actual race
(real AI-Focus render -> Overlay hydration -> auto-trigger -> Published) could not be exercised in
the dev-container sandbox (Modal disabled, no seeded fixture data - an existing, already-documented
sandbox limitation per `e2e/T8520-T8530-overlay-choice-and-publish.spec.js`'s header, not new to
this task). Verified instead via a real red->green proof against the actual `scheduleExportWhenReady.js`
module (not a mock/argument-shape check) plus the full curated relevant test set green. **The "one
tap on staging" criterion above is left unchecked until someone live-drives it on staging** -
merged per this project's merge-when-provably-verified policy (genuine red->green proof + CI green
modulo the known pre-existing flake), consistent with "staging IS the test phase."

PR: #417 (merged, `0e9ae01f`). Branch: `feature/T9740-publish-without-spotlight-not-one-tap` (deleted post-merge).

## Staging Verification (2026-09-12)

**Verdict: FAIL** on the "Publish without spotlight completes in one tap" acceptance criterion.
**PASS** on the "Add spotlight path continues to work" acceptance criterion (no regression).

Performed the same live-browser re-drive T9710 used to originally find this bug: real
`dev-login` (`X-Test-Mode: true`) as the same disposable staging fixtures, a real AI-Focus render
against real staging infra (Modal), watching the network log through the Overlay transition.
Confirmed running against the actual merged build the whole time (`x-app-version:
0e9ae01f42b261cc6b0fc69bdb9a62b70740d056`, console `[Build] 0e9ae01f (#5007)`).

### Setup

- **Accounts** (same as T9710, no new accounts created): publisher `e2e@test.local` (user
  `90625c7c-0b82-481d-85f7-2b9308beb831`, profile `a1e7e514`); viewer `e2e-gate@test.local` was not
  needed this round (AC4 link-access was already verified by T9710 and is out of scope here — this
  task only reopens AC2/AC3).
- **Game**: the same disposable fixture game T9710 used, "Vs Carlsbad SC Aug 30" (game id 1,
  90s test video). The parent walkthrough's own game/objects were never opened.
- **New test objects created** (non-overlapping timecodes, clear of T9710's existing annotations at
  0-3s, 3.996-15.996s, 29.997-41.997s, 49.177-61.177s):
  - **project 5, "T9740 TEST clip (no spotlight)"** — play marked 1:06-1:18.
  - **project 6, "T9740 TEST clip (add spotlight)"** — play marked 1:17-1:29.
- Both clips completed a real AI-Focus render (one manually-placed crop keyframe, ~65-95s render
  including Modal player-detection) before reaching the T9590 post-Focus dialog.

### AC2 — Publish without spotlight (project 5) — FAIL

Clicked **Publish without spotlight** from the T9590 dialog. Watched the network log continuously
through the Overlay transition (no fixed wait — polled every few seconds):

1. Navigated to `/overlay` as expected.
2. Within ~3s, a SECOND `POST /api/export/render` fired automatically
   (`export_id=export_1789182958506_xx8pit1`, body `{project_id:5, export_mode:"fast",
   target_fps:30, include_audio:true}`) — **this is new**: on the original bug, nothing fired for
   90+ seconds. `scheduleExportWhenReady`'s fix to the null-ref race genuinely works: the poll DOES
   find a non-null `exportButtonRef.current` quickly and DOES call `triggerExport()`.
3. The render progressed visibly (30% -> 90% "Uploading" -> complete) and **did** update the
   project: `GET /api/projects/5` afterward showed `working_video_id: 5` (a fresh render,
   timestamped `2026-09-12 03:16:50`), confirming a real render completed successfully.
4. **But `final_video_id` stayed `null`, `has_final_video: false`.** No `/api/downloads/publish`
   call ever fired. No completion dialog appeared. After the render finished, the UI silently
   reverted to the plain pre-export **"Export clip with effects"** button — as if nothing had
   happened. Waited 35+ seconds past completion; no change, no toast, no error.
5. This is a **contract failure, not merely "still slow"**: the wrong export endpoint fired.
   `/api/export/render` is the FRAMING/AI-Focus render endpoint; the Overlay/spotlight-less render
   the "one tap" mechanism needs is `POST /api/export/render-overlay` (confirmed distinct endpoint,
   `src/backend/app/routers/export/overlay.py:2856`). The auto-triggered call hit the FRAMING
   endpoint, so the backend only ever updated `working_video`, never produced a `final_video`, and
   `App.jsx`'s `handleExportComplete` (`src/frontend/src/App.jsx:582-633`) — which gates the
   auto-publish on `completed?.mode === EDITOR_MODES.OVERLAY` — never even entered its auto-publish
   branch, because the completion it received reported `mode: 'framing'`.
6. Manually clicking **Export clip with effects** afterward (on the SAME project, now in a genuine
   Overlay-mounted state) worked correctly: fired `POST /api/export/render-overlay` (200), showed
   the proper T9110 completion dialog with a **Publish** primary action, and clicking it fired
   `POST /api/downloads/publish/5` (200) — clip published normally. This isolates the bug to the
   AUTO-TRIGGER specifically, not the Overlay export/publish mechanism in general.

**Root-cause hypothesis (code-supported, not breakpoint-confirmed — flagging as hypothesis per
this project's convention, same as T9740's own original "Root Cause" section):**
`scheduleExportWhenReady`'s `isReady: () => !!exportButtonRef.current` check is necessary but not
sufficient. `exportButtonRef` is a SINGLE ref shared across mode-specific button instances — Focus's
own `ExportButtonSection` (the "Generate AI Focus" control, `FocusScreen.jsx`
`FocusModeView.jsx:813-829`) stays mounted and bound to that ref for as long as `videoUrl` is set
and the view isn't fullscreen — which spans the ENTIRE time the T9590 dialog is showing on top of
it (the dialog is explicitly "an overlay ON TOP of the still-mounted Focus editor" per the
`handleRefocus` comment) and beyond. `scheduleExportWhenReady`'s `tick()` runs SYNCHRONOUSLY once,
immediately, before returning (`FocusScreen.jsx:1160-1165` calls `setEditorMode('overlay')` then
`scheduleExportWhenReady({...})` with no `await`/deferral in between) — so its first readiness
check runs on the SAME tick as the click handler, before React has even processed the
`setEditorMode('overlay')` state change, let alone unmounted Focus / mounted Overlay. At that
instant `exportButtonRef.current` is non-null, but it's still FOCUS's instance (closed over
`editorMode === FRAMING`), so `fire()` calls `triggerExport()` on it, and
`ExportButtonContainer.jsx`'s FRAMING branch (`:601-710`) posts to `/api/export/render` — exactly
matching what was observed. The fix's premise ("exportButtonRef only attaches once Overlay's export
button mounts") assumed the ref starts out null before Overlay mounts; in reality it starts
non-null (Focus's own button) and stays non-null straight through the mode switch, so the poll
"succeeds" on tick zero against the wrong target instead of ever waiting for Overlay. A correct
`isReady` would need to confirm identity/mode (e.g. that the CURRENT `editorMode` store state is
already `overlay`, or that Overlay's button specifically — not just some button — has attached),
not just non-nullness.

### AC3 — Add spotlight (project 6) — PASS, no regression

Clicked **Add spotlight** from the T9590 dialog (project 6). Confirmed no auto-export fired (by
design — `handleAddSpotlight` never calls `scheduleExportWhenReady`): waited 3s in Overlay mode,
only the plain "Export clip with effects" button was present, no export in progress. Manually
clicked it: `POST /api/export/render` (48) for the earlier AI-Focus stage, then
`POST /api/export/render-overlay` (69, 200) for the actual spotlight export, completion dialog
appeared with **Publish** primary, clicked it, `POST /api/downloads/publish/6` (200) — published
correctly in a clean two-click flow (Export -> Publish) exactly matching T9710's original AC3
finding. **The T9740 fix did not regress this path.**

### Cleanup

- No share links were created for either test clip (this task's scope was AC2/AC3 only, not AC4
  link access, which T9710 already verified) — nothing to revoke.
- Both `T9740 TEST clip *` objects (project 5, project 6) were left in place on the disposable
  `e2e@test.local` fixture account, both now published, clearly labelled, same disposition T9710
  used for its own test objects. The parent walkthrough's objects and T9710's own test clips were
  never opened or touched.

### Recommendation

This is more than "still unverified" — it's a confirmed, reproducible failure of the acceptance
criterion under real staging conditions, with a different (and arguably worse — it now burns a
real render silently) failure mode than the one originally diagnosed. Recommend a follow-up fix
task before promoting this task past STAGING: `scheduleExportWhenReady`'s readiness check needs to
distinguish "a button is mounted" from "the OVERLAY button is mounted," most likely by gating on
the store's `editorMode === EDITOR_MODES.OVERLAY` in addition to `!!exportButtonRef.current`, or by
having Overlay's `ExportButtonSection` claim the ref through a mechanism that can't be satisfied by
Focus's still-mounted instance (e.g. a generation/identity token bumped on mount). Per this
project's async-timing escalation policy, this warrants another expert-agent consult rather than a
second Sonnet guess, given the first fix already went through that process and still missed this.

## Resolution — Fix v2 (2026-09-12)

**Confirmed root cause (this time by construction, not hypothesis):** exactly the ref-sharing /
tick-zero mechanism the Staging Verification section above hypothesized. `App.jsx` created ONE
`exportButtonRef` and handed the SAME object to both `<FocusScreen>` and `<OverlayScreen>`. Focus's
own export button stays mounted on that ref while the T9590 dialog sits on top of the Focus editor,
so the ref is NON-NULL from the instant Publish is clicked. `FocusScreen.handlePublish` called the
readiness scheduler synchronously in the same tick as `setEditorMode('overlay')`, so
`scheduleExportWhenReady`'s first (synchronous) `tick()` ran BEFORE React swapped Focus out for
Overlay — `isReady: () => !!exportButtonRef.current` was satisfied on tick zero by Focus's still-mounted
FRAMING button, firing `POST /api/export/render` (framing) instead of the overlay render. 100%
reproducible, not a race.

**Fix — split the ref, do NOT "wait smarter":** give each mode its own export button ref
(`focusExportButtonRef`, `overlayExportButtonRef` in `App.jsx`), passed to their respective screens.
A new `scheduleOverlayPublishExport({ overlayExportButtonRef, projectId, onAbandon })` (in
`src/frontend/src/utils/scheduleExportWhenReady.js`) binds the poll to Overlay's ref specifically, so
`isReady` becomes true BY CONSTRUCTION only once Overlay's own button mounts — no tag to keep in sync,
no reliance on React scheduling.

**The Staging Verification section's own "Recommendation" (gate on `editorMode === EDITOR_MODES.OVERLAY`
in addition to `!!ref.current`) was REJECTED as provably broken:** `setEditorMode` is a synchronous
Zustand `set()`, so `editorMode` is ALREADY `'overlay'` on the tick-zero check while a shared
`exportButtonRef.current` is STILL Focus's handle — the compound check `editorMode === OVERLAY &&
!!ref.current` is true at t=0 and fires on the framing button exactly as before. This was confirmed
by a second Opus expert-agent consult (per the async-timing escalation policy) before implementation.
Also rejected: deferring the first check via microtask/rAF (Overlay is `React.lazy` behind Suspense,
so the swap can span multiple commits — narrows the window by luck only), and having Overlay's mount
write to `publishIntentStore` (banned reactive-persistence-on-mount).

**Also added:**
- `scheduleExportWhenReady` gained an `onAbandon` callback that fires exactly once if the poll gives
  up before ever firing (the publish-intent stake expired before Overlay's button mounted). `App.jsx`
  wires it to a loud `console.error` + a recovery `toast.error` ("Couldn't start the render — Tap
  Export clip with effects to finish publishing."), turning the old silent stranding into a visible
  failure with a recovery path.
- `App.jsx handleExportComplete` gained a log-only named assertion: if a NON-overlay completion
  arrives while a publish intent is staked for that project, the wrong button fired — logs
  `console.error` (no behavior change), so any future recurrence of this bug class is loud, not silent.

**Tests (the first fix's tests could not have caught this):** the merged fix's scheduler tests drove
`isReady` from a boolean that STARTS `false` (presupposing the gate begins closed), and
`focusPublishExit.test.jsx` wired a SINGLE identity-free `triggerExport` spy — so a poll that fired the
WRONG button on tick zero still read as "fired once", green. New coverage:
`scheduleExportWhenReady.test.js` now exercises `scheduleOverlayPublishExport` with TWO separate ref
objects (focus non-null from the start, overlay null until it mounts) and a NEGATIVE CONTROL against
the old single-shared-ref predicate proving it DOES fire the focus button on tick zero; plus onAbandon
unit tests. A new RTL test (`scheduleOverlayPublishExport.rtl.test.jsx`) uses real
`forwardRef`/`useImperativeHandle` FakeButtons so React's actual attach/detach ordering runs, asserting
the framing button is never triggered through the transition and the overlay button fires once its
video hydration lets it mount. Red/green proven literally against the pre-fix scheduler (4 tests fail —
`scheduleOverlayPublishExport` undefined — while the negative control passes; all green after the fix).

**Verification status — NOT fully verified in-container:** build (vite, exit 0) + lint (0 errors) +
the curated relevant set green (39 tests: `scheduleExportWhenReady.test.js` 13, RTL 1,
`focusPublishExit.test.jsx` 15 confirming the "Add spotlight" contrast path is unregressed,
`overlayPublishExit.test.jsx` 10). The REAL race (real Modal AI-Focus render → Overlay hydration →
auto-trigger → Published) CANNOT be exercised in the dev-container sandbox (Modal disabled, no seeded
fixtures) — the same documented limitation that let this exact bug slip past unit tests twice. **A
live-staging re-verification pass (re-drive AC2 "Publish without spotlight completes in one tap" the
way the Staging Verification section above did) is still required after merge before checking that
acceptance criterion.**

Branch: `feature/T9740-publish-without-spotlight-fix-v2` (fresh branch off master for the same task id;
PR #417's branch was deleted post-merge). Status stays WIP until this merges (supervisor sets STAGING).

## Staging Verification — Fix v2 (2026-09-12)

**⚠ VERDICT: FAIL on AC2 ("Publish without spotlight completes in one tap") — THIRD consecutive miss
on this acceptance criterion, across three independent fix attempts (original bug, PR #417/v1, PR
#418/v2). Flagging prominently per this round's instructions: do not attempt a fourth fix without a
human or another expert-agent decision on next steps.**

**However, this is real, measurable progress, not a repeat of either prior failure mode** — the
specific mechanism Fix v2 targeted (the shared `exportButtonRef` firing on the wrong, still-mounted
Focus button) is **confirmed genuinely fixed**. The auto-triggered export this round hit the
**correct** endpoint (`/api/export/render-overlay`), completed successfully, and produced a real
`final_video`. What still doesn't happen automatically is the LAST step: the publish call itself. Net
manual-gesture count is now **1** (a single manual "Publish" click) versus the **3** manual gestures
of the original bug and the **2 wasted + stranded** outcome of v1 — real narrowing, but the acceptance
criterion is "zero manual clicks after the initial tap," and that is not met.

### Build verification

Confirmed running the actual merged build the whole time, on both halves of the stack:
- **Backend**: `curl -D- https://reel-ballers-api-staging.fly.dev/api/health` →
  `x-app-version: de84a1551b0bba50987dafd3f8631e400011a18f` (the Fix v2 commit) from the very start.
- **Frontend — caught a real gotcha, not just a checkbox**: the first page load showed console
  `[Build] 0e9ae01f (#5007)` — the OLD v1 build — even though `curl`ing the live `index.html` directly
  (bypassing the browser) already referenced fresh asset hashes. Root cause: a Workbox
  service worker (`workbox-precache-v2-https://reel-ballers-staging.pages.dev/`) from an earlier
  session was serving a stale cached app shell. Confirmed via `GET Deploy Frontend` GitHub Actions run
  history that the v2 deploy (`de84a155`) had genuinely already run and succeeded — this was a client
  cache issue, not a bad deploy. Unregistered the service worker + cleared the Cache Storage entry via
  `navigator.serviceWorker.getRegistrations()`/`caches.delete`, reloaded, and got the correct
  `[Build] de84a155 (#5010)`. **Flagging this as a standing risk for future staging verification
  rounds**: a persistent Playwright/browser profile can silently pin an old PWA build past a real
  deploy, making a genuine fix look unfixed (or, worse, making a genuine regression look fine if the
  cached build happens to predate it) unless the SW/cache is explicitly cleared and the build banner
  double-checked after every navigation to staging.

### Setup

- **Account**: publisher `e2e@test.local` (user `90625c7c-0b82-481d-85f7-2b9308beb831`, profile
  `a1e7e514`) — already had a live session cookie in this browser profile from prior rounds; no fresh
  `dev-login` needed, confirmed identity via `GET /api/auth/me` and `GET /api/bootstrap` before doing
  anything else.
- **Game**: same disposable fixture "Vs Carlsbad SC Aug 30" (game id 1). Before this round it carried
  6 annotations spanning roughly 0:00–0:03, 0:04–0:16, 0:29–0:41, 0:49–0:61, 1:06–1:18, 1:17–1:29 (the
  parent walkthrough's own annotation is not on this game; T9710's and T9740 v1's test clips are).
  The only gap large enough for a new 12s "Mark play" annotation without overlapping any prior round's
  object was 0:16–0:29 (~13s).
- **New test objects created this round** (both clearly labelled, non-overlapping with every prior
  round's annotations):
  - **Project 7, "T9740 v2 TEST clip"** — annotation window 0:16.3–0:28.3 (12.0s, the tool's fixed
    default), used for the AC2 "Publish without spotlight" drive.
  - **Project 8, "T9740 v2 TEST clip (add spotlight)"** — annotation window 0:41.5–0:47.9 (6.4s).
    The default 12s window didn't fit in the remaining ~8s gap (0:41–0:49); the Annotate marking
    overlay's mini-timeline has real drag handles (`cursor-col-resize`) on the highlighted region, and
    dragging the start handle right shrank it to 6.4s, clear of both neighbors. Used for the AC3
    contrast check.
  - Both clips completed a real AI-Focus render (one manually-placed crop keyframe each, real Modal
    player-detection, ~50–65s and ~45s respectively) before reaching the T9590 post-Focus dialog.
- **Note on a UI quirk hit while creating these** (not part of the bug under test, flagging for
  awareness): pressing the `A` hotkey to mark a new play does NOT anchor the window to the current
  seek position if a clip is already selected — it reopens editing on whatever clip is currently
  `SELECTED` instead of creating a new one (`AnnotateContainer.handleAddClipFromButton`:
  `selectionState.type === 'SELECTED' ? editClip(...) : startCreating()`). Two clips were very briefly
  auto-selected mid-session by an "auto-select clip at playhead" effect while the video was
  inadvertently left playing (`T9710 TEST clip C`, `T9710 TEST clip A`) — both were opened only via
  `Cancel (Esc)` with no field ever edited, and both were re-confirmed unchanged by name immediately
  after. Neither was modified.

### AC2 — Publish without spotlight (project 7) — FAIL (narrower failure than both prior rounds)

Clicked **Publish without spotlight** from the T9590 dialog on project 7. Watched the network log
continuously (polled every few seconds, never a single fixed wait) through the entire transition:

1. Navigated to `/overlay` as expected (`overlay_offered` → `overlay_declined` →
   `opened_overlay_editor` achievements fired, same sequence as both prior rounds).
2. Within seconds, `POST /api/export/render-overlay` fired automatically — **the correct endpoint**,
   not `/api/export/render` (v1's bug). Response: `200`.
3. `GET /api/projects/7` immediately after confirmed a real, successful render:
   `working_video_id: 7`, `final_video_id: 6`, `has_final_video: true`,
   `final_video_created_at: 2026-09-12 06:09:27`. No wasted render, no wrong `mode` — this is a
   genuinely correct overlay export, unlike v1 where the same moment produced a framing-mode
   `working_video` with `final_video_id: null`.
4. **No `POST /api/downloads/publish/7` (or any `/publish` URL) ever fired** — confirmed by filtering
   the full network log for `publish` (regex, case-sensitive on an all-lowercase URL): zero matches
   for the entire session, from the initial click onward.
5. The UI settled on `/home/reels` showing project 7 under a **"Ready to Publish"** bucket with an
   explicit manual **"Publish clip"** button — not the Published bucket, and not the T9110 completion
   dialog with its own Publish action (that dialog DID appear and fire correctly in the AC3 run below,
   so its absence here is notable).
6. Waited an additional 15s past the point `final_video_created_at` was already stamped, then
   re-fetched `/api/projects/7` and re-checked the network log: identical state, no new `publish`
   call, no further transitions. This is a **stable, settled end state**, not a slow-arriving
   auto-publish that simply needed more time.
7. Console showed **0 errors** throughout (25 warnings, all pre-existing video-buffering/slow-fetch
   noise unrelated to this flow). Notably, this means Fix v2's two new named log points **neither**
   fired: no `onAbandon` (`console.error` + toast — would mean the poll gave up before Overlay's
   button ever mounted) and no `handleExportComplete` wrong-mode assertion (would mean a non-overlay
   completion arrived while a publish intent was staked). Both of those absences are consistent with
   the render pipeline working correctly end-to-end through "produce a final video" — the gap is
   specifically that nothing downstream of a **successful, correctly-moded** completion calls
   `/api/downloads/publish`.
8. Manually clicking **Publish** on the "Ready to Publish" card afterward completes the flow
   correctly (not separately re-verified this round beyond confirming the button and card are present
   and correctly labelled — re-driving that manual path wasn't necessary to establish the FAIL
   verdict, and the task's own scope is the AUTO-trigger, not the manual fallback's correctness, which
   was never in question).

**Framing relative to prior rounds, for whoever picks this up next:** the failure surface has
narrowed twice now — original bug: 3 manual gestures, one through spotlight-editing UI the user
declined; v1: correct number of intended auto-steps but wrong button fired, burning a real render and
silently stranding the user with zero forward progress (had to manually export from scratch); v2 (this
round): the auto-export is now fully correct and produces the real final asset with zero waste, but
the handoff from "export finished" to "call publish" does not fire. This suggests the remaining gap is
specifically in the auto-publish trigger path (`App.jsx`'s `handleExportComplete` / whatever reads
`publishIntentStore` after a completion is confirmed overlay-moded) rather than anywhere in the
`scheduleOverlayPublishExport` poll or the ref-splitting fix itself — but per this round's
instructions, that is a hypothesis for the next investigation, not a diagnosis to act on here.

### AC3 — Add spotlight (project 8) — PASS, no regression

Clicked **Add spotlight** from the T9590 dialog (project 8). Confirmed no auto-export fired (by
design): checked the network log immediately after landing on `/overlay` — only the earlier AI-Focus
`/api/export/render` call was present, no `render-overlay` call yet. Manually clicked **Export clip
with effects**: `POST /api/export/render-overlay` fired (200), the T9110 completion dialog appeared
correctly with **Publish** as the primary action and caption *"Adds it to your Highlight Reels --
anyone with the link can watch it"*, clicked it, `POST /api/downloads/publish/8` fired (200), and the
Published count on the home screen incremented from 3 to 4. Clean two-gesture flow (Export → Publish),
exactly matching both prior rounds' findings for this path. **No regression from Fix v2** — consistent
with the diff review's earlier static confirmation that `handleAddSpotlight` is untouched.

### Cleanup

- No share links were created for either test clip this round. A post-publish "Play 8" dialog offered
  **Share**/**Close** after the AC3 publish; **Close** was clicked, no share link generated — nothing
  to revoke.
- Both new objects (project 7 "T9740 v2 TEST clip", still Ready-to-Publish; project 8 "T9740 v2 TEST
  clip (add spotlight)", now Published) were left in place on the disposable `e2e@test.local` fixture
  account, clearly labelled, matching the disposition both prior rounds used for their own test
  clips. Every prior round's own objects (T9710's clips A/B/C, T9740 v1's "no spotlight"/"add
  spotlight" clips, the parent walkthrough's own game/annotations) were confirmed present and
  unmodified by name at the end of this session.

### Recommendation

Do not attempt a fourth Sonnet-driven fix on this acceptance criterion without a human decision or a
fresh expert-agent consult first — that is what this round's instructions asked for, and three misses
on one AC (two of them past an expert-agent design review) is exactly the pattern CLAUDE.md's
escalation policy exists for. Worth putting in front of that review: (a) the concrete, narrowed
symptom above (correct render, correct final_video, zero downstream publish call, 0 console errors —
i.e., nothing is loudly failing, the auto-publish call is just never attempted), and (b) whether the
underlying approach — a client-side poll auto-firing a chain of "when X mounts, do Y; when Y
completes, do Z" — is the right shape at all for a promise as strong as "zero manual clicks," given
this is the third distinct way that chain has broken (missing ref identity, then wrong ref identity,
now an apparently missing or non-firing final link) without ever failing a unit test first.

## Resolution — Fix v3 (2026-09-11)

**⚠ LIVE-STAGING RE-VERIFICATION IS STILL REQUIRED. This is the FOURTH attempt; the three prior
rounds each passed their own unit tests and then failed live on real staging (real Modal render ->
Overlay hydration -> auto-trigger -> Published), a race the dev-container sandbox cannot reproduce
(Modal disabled, no seeded fixtures). The unit/RTL coverage below is the in-container proof; the
supervisor/user must re-drive AC2 on staging before this AC can be checked.**

**Confirmed root cause (WS+HTTP double-fire -> fetchProjects abort -> stale snapshot -> silent bail).**
A "publish without spotlight" overlay render has NO enabled highlight keyframes, so the backend takes
the **synchronous-200 path** in `src/backend/app/routers/export/overlay.py` (`if not has_keyframes and
not has_text`, ~lines 3051-3125): it sends the WebSocket `status:"complete"` frame FIRST
(`await manager.send_progress(...)`) and THEN returns HTTP 200. `ExportButtonContainer.jsx` opens the
WebSocket (`await connectWebSocket`) BEFORE the POST, so BOTH transports deliver the same completion
and `onExportComplete` fired **TWICE** (all 6 of its call sites were unguarded — the sibling
`overlayTransitionFiredRef` one-shot guard existed for `onProceedToOverlay` but `onExportComplete`
never got the same protection). Both invocations of `App.jsx handleExportComplete` call
`fetchProjects({ force: true })`, and in `projectsStore.js` a forced fetch ABORTS any in-flight fetch;
the abort catch path returns `get().projects` (STALE) with no `set()`. Whichever invocation resolves
first reads the stale snapshot where `final_video_id` is still `null`, passes the outer gate, calls
`goToProjectManager()` (navigating home), then **silently bailed** at `if (finishedProject?.final_video_id)`.
The second invocation then found `currentMode` no longer `overlay` (the first already navigated home)
and its outer gate failed. Net: navigated home, publish never called, **zero console errors**, project
stranded in "Ready to Publish" — exactly the staging observation, three rounds running.

**The two-half fix (shipped together):**

- **Fix A — one-shot `onExportComplete` per export** (`src/frontend/src/containers/ExportButtonContainer.jsx`):
  new `completionFiredRef` (reset per-export beside `overlayTransitionFiredRef.current = false`, NOT
  per-mount) + a single `fireExportComplete(payload)` helper that no-ops on the second call. ALL SIX
  completion call sites (WS `onComplete`, retry-connection, framing-single sync-200, overlay sync-200,
  multi-clip framing, overlay legacy `/final`) now route through it. Grep-proven: the only bare
  `onExportComplete` references left are the prop declaration, the guard/await inside the helper, and
  dependency arrays.
- **Fix B — restructured completion decision, EXTRACTED to a testable module**
  (`src/frontend/src/utils/handleOverlayExportCompletion.js`, called by a thin `App.jsx handleExportComplete`
  wrapper). Three structural moves: (1) **claim the publish-intent stake SYNCHRONOUSLY, before any
  `await`** — the stake IS the idempotency token, so any future double-fire from any transport is a
  no-op by construction; (2) **split the NAVIGATION decision from the PUBLISH decision** — publish is
  gated ONLY on the one-tap stake (wandering to another screen mid-render suppresses only the
  screen-hijack navigation, never the publish), while `goToProjectManager()`/`openFinishedReel` stay
  gated on the mode/id check; (3) **DELETE `finishedProject?.final_video_id` as a publish precondition**
  — it was a proxy read off a possibly-stale in-memory snapshot and guards nothing the server does not
  guard better (`downloads.py` returns a loud 404 off the real `final_videos` row). `finishedProject`
  is kept only as the preview-snapshot object; if missing, `console.error` + skip the preview but STILL
  publish. **No silent bails anywhere** — every decline-to-publish / decline-to-navigate path logs a
  named, greppable `console.error`.
- **Hardening** (`src/frontend/src/hooks/usePublishProject.js`): `publish` accepts an explicit
  `projectId` override (`targetId = projectId ?? project.id`); `App.jsx` passes `completed.projectId`
  from the completion payload, so the publish target never comes from the reactive
  `publishIntentStore` selector binding that could go stale in a long-lived callback.

**Why AC3 ("Add spotlight") cannot regress:** `FocusScreen.handleAddSpotlight` (lines 1085-1099)
CLEARS any publish-intent stake for the project and never stakes one, so `isOneTapPublish` is `false`
there, the new publish block is never entered, and `OverlayScreen` keeps owning the completion
experience. Fix A only removes a DUPLICATE invocation that was already a no-op on its second firing
for that path. Locked by test case (d).

**Tests + RED->GREEN proof (mandatory, produced explicitly):**
- Deleted the flawed `appPublishAfterRender.test.js` (it hand-copied the decision branch into a local
  replica AND hard-coded `finishedProject = { final_video_id: 999 }` — the exact precondition that
  FAILS in production; a landmine, not coverage).
- `ExportButtonContainer.completionDedup.test.jsx` (Test 1): mounts the REAL container in overlay
  mode; a mocked 200 POST + a mocked WS `complete` frame for the same export_id -> asserts
  `onExportComplete` called EXACTLY ONCE; plus a 202-then-WS-only regression case (also once).
- `handleOverlayExportCompletion.test.js` (Test 2, against the REAL extracted module with a real
  `publishIntentStore`): (a) intent staked + snapshot MISSING `final_video_id` -> publish STILL fires
  (**THE production bug**); (b) intent staked + navigated away -> publish fires, no nav/preview;
  (c) handler invoked twice concurrently -> publish fires exactly once; (d) no intent staked -> publish
  NEVER called (AC3 lock).
- **RED first, GREEN after (unchanged tests):** against the pre-fix source (master
  `ExportButtonContainer.jsx` + a buggy-baseline module mirroring old App.jsx) — Test 1 sync-200 FAILED
  ("onExportComplete called 2 times"), Test 2 (a) FAILED ("publish called 0 times"), (b) FAILED
  ("publish not called"); after restoring the fix, all 6 GREEN.
- Curated relevant set (12 files / 112 tests) GREEN: the two new files +
  `ExportButtonContainer.doubleClick.test.jsx`, `ExportButtonContainer.test.js`, `ExportButtonView.test.jsx`,
  `usePublishProject.test.jsx`, `DraftReelPreview.test.jsx`, `focusPublishExit.test.jsx`,
  `overlayPublishExit.test.jsx`, `scheduleExportWhenReady.test.js`,
  `scheduleOverlayPublishExport.rtl.test.jsx`, `publishIntentStore.test.js`. eslint 0 errors, vite
  build exit 0.

**Verification gap (unchanged from all prior rounds, stated plainly):** the REAL race cannot be
exercised in the dev container. Live-staging re-verification of AC2 is the supervisor's/user's
follow-up before promoting past STAGING.

Branch: `feature/T9740-publish-without-spotlight-fix-v3` (fresh off master for the same task id).
