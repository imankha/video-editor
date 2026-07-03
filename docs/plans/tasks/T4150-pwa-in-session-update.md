# T4150: PWA In-Session Update (stop users lagging on stale builds)

**Status:** TODO
**Impact:** 5 | **Complexity:** 2 | **Priority:** 2.5
**Stack Layers:** Frontend

## Problem

The app is an installed-PWA / service-worker app. It's configured `registerType: 'autoUpdate'`
(`src/frontend/vite.config.js`) and the deployed sw.js has `skipWaiting` + `clientsClaim`, so
new builds DO download and activate in the background. BUT the app never imports
`virtual:pwa-register`, so there is NO in-session update: a new version only takes effect on the
NEXT app load, and there is no "update available" prompt or auto-reload. A user who keeps the
installed PWA open long-lived (never fully closes it) can run a build that is many versions old.

> **Correction (2026-07-02, post-merge):** the motivating incident below was later attributed to
> T4160 (sweep auto-export publishes raw stream-copies over framed reels), NOT a stale PWA bundle —
> see the T4160 task file. The update gap this task fixes is real and shipped anyway; only the
> incident attribution was wrong.

This is not hypothetical — it caused a full false-alarm debugging session: a prod user
(imankh@gmail.com) saw the ranking game showing unframed 16:9 raw clips labeled "Clip 16"/"Clip 5".
Investigation proved the CURRENT deployed backend + bundle can't produce that screen (live
`/api/rank/next` returns framed 9:16 reels; 0 16:9 reels exist; "Clip {id}" is the raw-clip label
fallback from the PRE-T3630 raw-clip ranker). The only explanation left standing: the user's
installed PWA was serving a stale cached bundle from before the ranking→reels migration. Auto-update
would have fixed it on next load, but the long-lived PWA never got that "next load".

## Verified facts (do not re-investigate)

- `src/frontend/vite.config.js` — VitePWA, registerType 'autoUpdate', workbox precaches
  `**/*.{js,css,html,svg,png,woff2}`; only runtimeCaching is Google avatars (CacheFirst). App shell
  is precache. `__COMMIT_HASH__` is already defined and could be surfaced for debugging.
- Deployed sw.js: contains skipWaiting + clientsClaim (confirmed via curl of app.reelballers.com/sw.js).
- Deployed registerSW.js: bare `navigator.serviceWorker.register('/sw.js', {scope:'/'})` — default
  updateViaCache 'imports', so the browser bypasses the HTTP cache when re-checking sw.js (the 4h
  max-age on sw.js does NOT block update detection).
- `grep virtual:pwa-register|registerSW|updateSW|onNeedRefresh` in `src/frontend/src` → EMPTY. No
  in-session update handling exists. This is the gap.

## Classification

**Stack Layers:** Frontend
**Files Affected:** ~2-3 (app entry, maybe a small toast component, possibly vite.config.js)
**LOC Estimate:** ~30-60
**Test Scope:** Frontend Unit + manual/E2E (SW update behavior)

### Agent Workflow

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Change is localized to the app entry; root cause already traced. |
| Architect | No | Well-understood vite-plugin-pwa pattern; only a small UX decision (below). |
| Tester | Yes | Verify the update path fires and doesn't interrupt active editing. |
| Reviewer | No | Small, pattern-following change. |
| Migration | No | No schema/data change. |

### Skipped Stages

Architecture (single small UX decision, resolve inline), Code Expert, Reviewer.

## UX decision: how an available update is applied

**CHOSEN: non-intrusive toast** — set `registerType: 'prompt'`, import
`registerSW({ onNeedRefresh })`, show a small "New version available — Refresh" toast that calls
`updateSW(true)` on click. Safer for this app because it has heavy in-memory editing state
(framing/overlay/keyframes); a forced silent reload mid-edit could interrupt/confuse.

Rejected alternative: silent auto-reload (`registerType: 'autoUpdate'` +
`registerSW({ immediate: true })`) — simplest, but can reload mid-edit.

Either way, ALSO add a re-check for long-lived installed PWAs (the actual stuck case). Decided
(post-review): NOT a `setInterval` — browsers throttle/freeze background timers in installed PWAs,
and a page-lifetime interval widens the risk surface. Instead, a `visibilitychange` listener in
`onRegisteredSW`: when the app becomes visible, call `registration.update()` (rate-limited to one
check per 5 minutes), and if a SW is already waiting, re-surface the refresh toast (covers a
dismissed prompt). Returning to the app is exactly the moment the check should fire.

## Implementation

1. Branch: `feature/T4150-pwa-in-session-update`
2. In the app entry (`src/frontend/src/main.jsx`), import from `virtual:pwa-register` and call
   registerSW with the toast strategy + the visibility-triggered `registration.update()` re-check.
3. Set registerType 'prompt' in vite.config.js and wire a toast to `updateSW(true)` — reuse the
   existing `toast` helper + `ToastContainer` (`src/frontend/src/components/shared/Toast.jsx`,
   already mounted in App.jsx; supports `duration: 0` and an `action` button).
4. eslint has no import-resolution rule, so the virtual module import is not flagged. No TS.
5. Build check: `cd src/frontend && npm run build` must pass and still emit sw.js + registerSW.js.

## Verification

- `npm run build`, serve the dist, load app, then rebuild with a visible change and reload once →
  confirm the toast appears and the new build takes effect WITHOUT manually clearing
  storage/unregistering the SW.
- Confirm the visibility re-check fires: hide + reshow the tab -> `registration.update()` runs
  (rate-limited to one per 5 min); dismiss the toast, hide + reshow -> toast re-appears.
- Regression: normal navigation and existing flows unaffected; no reload loop.
- Frontend unit tests: `cd src/frontend && npm test` green.

## Key Rules

- Frontend only; no backend/DB/migration.
- Do NOT change task statuses in PLAN.md (leave T4150 as TODO for the user to promote).

## Known limitation (accepted)

This fix is prospective-only: clients already stuck on pre-T4150 bundles have no re-check code,
and browsers don't re-check sw.js for idle pages, so the currently-stale installed PWA needs ONE
manual full close/reopen after this deploys to get onto the new system. Accepted because the only
PWA user is the owner's account.
