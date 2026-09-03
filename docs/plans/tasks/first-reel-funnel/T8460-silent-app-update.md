# T8460: Silent app update, no blocking interstitial

**Status:** WIP
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source)

## Problem

The literal first frame a brand-new user sees on staging is a full-screen "A new version
is ready / Update now" modal covering the dimmed home screen (walkthrough screenshot
01-home-empty.png, 2026-09-02). The user must click through it before touching anything.

This is the strongest candidate yet for prod bug #18 ("I hit add your first game and
nothing happened", iPhone 352x541): the modal mounts at z-[60] ABOVE even the auth modal,
so it steals every tap. Cliff 1 (50% of users never start an upload) was measured with
this wall in place.

User decision 2026-09-03: the user should NEVER need to click update. Update silently;
if the swap takes time, report progress while it happens. Delete the click-gated flow,
do not just re-time it.

## How the current system works (read these files in this order)

1. `src/frontend/src/utils/appVersion.js` - the TRUTH check. `checkServerVersion(serverBuild)`
   (line 91) fires on every API response (via sessionInit.js's fetch interceptor reading
   the `X-App-Build` header) and on `GET /api/version` (pwaUpdate.js). Gate condition:
   `serverBuild > clientBuild` (baked `__APP_BUILD__`) AND `hasNewerBundle()` confirms a
   WAITING service-worker bundle (Tbug41s: backend-only deploys must never gate - the
   probe is throttled by `PROBE_MIN_GAP_MS` = 5 min). On both true it calls
   `useUpdateGateStore.getState().requireUpdate({ needsMigration: false })` (line 110).
2. `src/frontend/src/stores/updateGateStore.js` - state:
   `isUpdateRequired`, `needsMigration` (seam, always false today), `phase`
   ('idle'|'flushing'|'error'), `error`, `_swReloader` (set by pwaUpdate).
   `runUpdate()` (line 55) is the "Update now" gesture: if authenticated ->
   `await flushDurableState()` (updateFlush.js barrier; on throw -> phase 'error',
   NEVER reloads with unsynced state) -> `await _swReloader()`.
3. `src/frontend/src/utils/pwaUpdate.js` - all ServiceWorker mechanics.
   `setupPwaUpdatePrompt()` wires `setSwReloader(() => landLatestBundle(...))` and
   `setBundleProbe(() => probeForWaitingBundle(...))`; re-checks ride
   `visibilitychange` + `pageshow(persisted)` with a 5-min cooldown, plus one on-load
   check. `landLatestBundle` (line 172) is the ordered escalation:
   registration.update() -> skipWaiting via `updateSW(true)` + wait for
   'controllerchange' (3.5s timeout, Safari flake) -> postMessage SKIP_WAITING +
   unregister() + location.reload().
4. `src/frontend/src/components/UpdateGateModal.jsx` - pure view of the store
   (z-[60], role=alertdialog, copy "A new version is ready" / "We need to update
   before you continue. Your work is saved automatically." / button "Update now" |
   "Saving your work..." | "Try again"). Mounted in `main.jsx` above AuthGateModal.
5. Tests: `src/frontend/src/utils/appVersion.test.js` - includes the named regression
   'THE BUG, repeated: clicking "Update now" reloads onto the same bundle and STILL
   must not gate' (line ~117). These tests MUST keep passing; the truth-check and
   probe logic do not change.

## What to build

Keep the entire detection stack (appVersion.js + pwaUpdate.js) untouched. Change what
happens when the gate condition is met: instead of raising a blocking modal and waiting
for a click, run the update automatically at the first QUIESCENT moment.

### Step 1 - add quiescence to updateGateStore

Add to `updateGateStore.js`:

```js
// T8460: an update may only auto-run while the app is quiescent. Checked at
// trigger time (plain state reads, NOT a reactive effect).
isQuiescent: () => {
  const exporting = useExportStore.getState().activeExports?.length > 0;
  const uploading = /* pending upload in progress - see below */;
  const modalOpen = /* any modal open - see below */;
  return !exporting && !uploading && !modalOpen;
},
```

Concrete signals (verify each while implementing; they exist today):
- Active exports: `useExportStore` holds the active export list that
  `GlobalExportIndicator.jsx` renders ("N Export Active"). Import the store, read at
  call time with `getState()`.
- In-flight upload: the background upload that the Annotate progress card shows
  ("Uploading game-footage.mp4 ... 60%"). Find the store/hook it reads (grep
  "Uploading" in src/frontend/src, follow to the upload-progress state) and expose a
  boolean.
- Open modal: `QuestPanel.jsx` already solves "is any modal-or-above surface open"
  for the T8120 occlusion contract (it must never overlap a modal). Reuse that
  detection (extract the helper if it is component-local rather than re-implementing).
- Mid-gesture: do not attempt pointer tracking. Modal/upload/export cover the real
  cases; a reload between ordinary clicks is acceptable.

### Step 2 - auto-run instead of modal

In `requireUpdate()` (updateGateStore.js line 35), after setting `isUpdateRequired`:
- If `isQuiescent()` -> call `runUpdate()` immediately.
- If not -> DO NOT show the blocking modal. Retry on the existing re-check cadence:
  `checkServerVersion` fires on every API response anyway and the store is already
  gated (`isUpdateRequired` true short-circuits at appVersion.js line 98) - so add a
  small retry: when `isUpdateRequired && phase === 'idle'`, each subsequent
  `requireUpdate()` call re-tests quiescence and runs when clear. (This keeps the
  logic gesture/event-driven - no setInterval, no useEffect watching state. The
  "events" are API responses + visibilitychange, which is exactly when update checks
  already happen.)

First-session guard (user decision: never before the first meaningful action): if
`useAuthStore.getState().isAuthenticated` is false OR the games list is empty AND no
gesture has occurred yet, treat as non-quiescent. Simplest robust proxy: skip auto-run
while the Add Game modal or the upload flow could be about to start = the modalOpen +
uploading checks above already cover the dangerous window; additionally never auto-run
within the first 30 seconds after a cold boot of an unauthenticated session. Keep this
rule dumb and visible in one place with a comment.

### Step 3 - replace the modal with a passive progress indicator

Rewrite `UpdateGateModal.jsx` into a small, NON-BLOCKING corner card (reuse the visual
language of the export indicator, bottom-right) that renders ONLY while `phase ===
'flushing'` or `phase === 'error'`:
- flushing: spinner + "Updating to the latest version..." (the flush + SW swap is
  seconds; the reload then replaces the page).
- error: "Update paused - could not save your latest changes." + a "Retry" button
  (re-calls `runUpdate()`). The error state is the ONE remaining interactive surface,
  and it never blocks the app behind it.
Remove the z-[60] full-screen overlay entirely. Keep the component name (mounted in
main.jsx) to minimize the diff, or rename to `UpdateProgressCard` and update main.jsx.

### Step 4 - safety invariants that must survive

- `flushDurableState()` stays inside `runUpdate()`, called only from the update path
  (see updateFlush.js's header comment: "invoked from the 'Update now' click handler
  ONLY - never from a reactive effect"). Auto-run IS the new gesture-equivalent; update
  that comment to name T8460.
- The logged-out skip (updateGateStore.js line 59: no flush for unauthenticated
  sessions) stays.
- appVersion.test.js must pass unchanged. Add new tests in updateGateStore.test.js (or
  create it): (a) requireUpdate during an active export does not reload, (b)
  requireUpdate while quiescent calls the reloader after flush, (c) flush failure ->
  error card state, no reload, (d) a second requireUpdate after conditions clear runs
  the update.

### Step 5 - e2e

Extend or add `e2e/update-gate.spec.js`: stub `/api/version` + the X-App-Build header
to advertise a higher build with a fake bundle probe; assert (a) no `role=alertdialog`
ever appears, (b) the Add Game button remains clickable, (c) the progress card appears
during the flush phase. Run at 390x844 too (no occlusion of tap targets).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/updateGateStore.js` - quiescence + auto-run (main change)
- `src/frontend/src/components/UpdateGateModal.jsx` - becomes passive progress card
- `src/frontend/src/utils/updateFlush.js` - comment update only
- `src/frontend/src/utils/appVersion.js` + `appVersion.test.js` - NO behavior change
- `src/frontend/src/utils/pwaUpdate.js` - NO behavior change
- `src/frontend/src/main.jsx` - mount point
- `src/frontend/src/stores/exportStore.js`, upload-progress state, QuestPanel's
  modal-open detection - quiescence inputs

### Related Tasks
- Epic: first-reel-funnel (1/11). Watch prod bug #18 recurrence after ship.
- History to respect: T5070 (gate created), Tbug40p (truth check + Safari reload
  escalation), Tbug41s (bundle-probe veto). None of their invariants change; only the
  UI in front of `runUpdate()` does.

## Acceptance Criteria

- [ ] No user click is ever required to update (except the flush-error Retry)
- [ ] Update never fires during an active export, an in-flight upload, or with a modal open
- [ ] No blocking overlay exists in any update state; Add Game stays tappable throughout
- [ ] Progress is visible during the flush/swap; flush failure shows the paused card
- [ ] appVersion.test.js green unchanged; new store tests cover the 4 cases above
- [ ] e2e proves no alertdialog + tappable UI at 1280px and 390x844
