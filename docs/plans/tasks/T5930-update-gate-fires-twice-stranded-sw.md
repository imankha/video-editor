# T5930: "New version" gate fires TWICE (before and after login) — plain reload strands the waiting SW

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-26
**Source:** User report on staging 2026-07-26 — follow-up to **bug39** (whose fix is deployed and did not close this)

## Problem

> "I just looked at staging and I'm still being hit with a double 'New version' screen (before and
> after logging in). It should just run one time per account per new version (the immediate one)."

The blocking update gate appears, the user clicks "Update now", the page reloads — and the gate
appears **again** moments later, after logging in. Expected: one gate per new version, then done.

This is a trust/polish bug on the very first thing a returning user sees after a deploy. It also
makes the gate feel broken, which undermines a mechanism whose whole job is to be obeyed.

## Verified before filing (do NOT re-derive)

- The **bug39 fix IS deployed**. Staging frontend is built from `593224f9`, which contains
  `1822fe64` (bug39). There are **no** frontend changes on master since that build. So this is a
  surviving defect, not a missing deploy.
- The staging backend is **stable** at `a4a28293` — sampled `X-App-Version` 8× consecutively, all
  identical, so a flapping mixed fleet is NOT what is firing the gate right now.
- `UpdateGateModal` renders at `main.jsx:65`, outside any auth gating — the modal does **not**
  unmount/remount across login, so "twice" is two genuine `requireUpdate` events, not a render
  artifact.

## Root cause (leading hypothesis — instrument to confirm, then fix)

`updateGateStore.runUpdate()` (`stores/updateGateStore.js:76-86`):

```js
const { reason, _updateSW: updateSW } = get();
if (reason === 'sw' && updateSW) {
  await updateSW(true);          // skipWaiting -> workbox reloads
  return;
}
window.location.reload();        // version-mismatch branch
```

**A plain `window.location.reload()` does not `skipWaiting`.** The old service worker keeps
control and re-serves the OLD bundle; the freshly-installed new bundle stays *waiting*. That
waiting worker then fires `onNeedRefresh` → `requireUpdate('sw')` → **the second gate**.

Sequence matching the report exactly:
1. User has the app open across a frontend deploy AND a backend deploy.
2. Backend sha changes → `checkAppVersion` counts it twice → gate #1, reason `version-mismatch`.
3. User clicks "Update now" → version-mismatch branch → plain reload.
4. Old SW re-serves the old bundle; new bundle still waiting.
5. `onNeedRefresh` fires → gate #2, right around login.

**The existing mitigation is a race, and its own comment says so.** `requireUpdate`
(`updateGateStore.js:29-39`) lets `'sw'` upgrade a `'version-mismatch'` gate precisely to route
through `skipWaiting`, justified by:

> "By the time the user reads the modal and clicks, onNeedRefresh has fired, so the upgrade is in
> place."

That is a timing assumption about how fast a human reads a modal. Click before the SW finishes
installing (or on a slow/flaky network, or when the SW install is delayed) and the upgrade never
lands — you get the plain reload and the stranded-SW path. It holds in testing and fails in the wild.

## Solution direction (confirm at implementation)

1. **Stop depending on the `onNeedRefresh` race.** At click time, ask the registration directly
   whether a worker is waiting, rather than trusting that a callback already fired. `pwaUpdate.js`
   already holds `registration` and already does exactly this check in `onReturnToApp`
   (`registration?.waiting` → `requireUpdate('sw')`) — reuse that signal, don't invent a second one.
2. **Simplest shape to evaluate:** always attempt `updateSW(true)` first and fall back to
   `window.location.reload()`. The store's own comment (`:21-23`) documents `updateSW` as an
   idempotent no-op when nothing is waiting, which would make the reason-branch unnecessary.
   **Verify that no-op claim against workbox-window before relying on it** — if it is wrong, use the
   explicit `registration.waiting` check instead.
3. **Do not weaken the gate.** It must still be non-dismissible and must still fire for a genuine
   new version. The goal is ONE gate that actually lands the update, not a quieter gate.
4. **Preserve the flush barrier.** An authenticated user's `flushDurableState()` must still complete
   before any skipWaiting/reload — never reload with unsynced state. The logged-out skip
   (`:61`) must stay, or every deploy locks out unauthenticated users.

## Secondary question (decide, then state the answer in the report)

The user said *"one time per **account** per new version"*. Acknowledgement is currently
**per-tab** (`sessionStorage`, `appVersion.js:36`), deliberately: it must be readable before login,
and it is device/tab state, not user data. Assess whether per-tab is still the right scope given the
report, and either keep it with a stated rationale or propose the change. Do NOT move it into
SQLite/R2 casually — `CLAUDE.md` bans localStorage and this is explicitly not user data.

Note the asymmetry to consider: `acknowledgedVersion` suppresses only the **version-mismatch** path
(`appVersion.js:77`). `requireUpdate('sw')` has **no** version awareness, so an acknowledged version
cannot suppress an SW-triggered gate. Decide whether that is correct (a waiting bundle is a real,
different signal) or whether the ack should gate both.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/updateGateStore.js` — `runUpdate` (:57-86), `requireUpdate` (:27-44), `_updateSW` (:24-25)
- `src/frontend/src/utils/pwaUpdate.js` — `onNeedRefresh` (:31), `registration` (:28), `onReturnToApp`'s `registration?.waiting` check (:44-51)
- `src/frontend/src/utils/appVersion.js` — `checkAppVersion` (:62), `acknowledgeAppVersion` (:107), `ACK_VERSION_KEY` (:36)
- `src/frontend/src/components/UpdateGateModal.jsx` — the view
- `src/frontend/src/main.jsx:65` — render site (top level, outside auth)
- `src/frontend/src/stores/updateGateStore.test.js`, `src/frontend/src/utils/appVersion.test.js` — existing coverage to extend

### Related
- **bug39** (`1822fe64`, deployed) — fixed symptoms 1 & 3 (re-gating an accepted version) and added the race-dependent reason-upgrade for symptom 2. This task closes symptom 2 properly.
- **T5070** — introduced the blocking gate + flush barrier
- **T4150** — the 5-min visibilitychange throttle this reuses

## Acceptance Criteria

- [ ] Root cause CONFIRMED with evidence (instrument the two `requireUpdate` calls and show which
      reason fired each time) — do not fix on the hypothesis alone
- [ ] Clicking "Update now" once lands the new bundle — no second gate, with a waiting SW present
      and reason `version-mismatch` (i.e. the race lost)
- [ ] Regression test reproducing the stranded-SW path: reason `version-mismatch` + a waiting SW →
      assert `skipWaiting` is taken, not a bare reload. **Must go red without the fix.**
- [ ] The gate still fires for a genuine new version, and is still non-dismissible
- [ ] Authenticated flush barrier still runs before reload/activation; logged-out users still skip it
- [ ] The per-tab-vs-per-account acknowledgement question is answered explicitly in the report
- [ ] Real-browser evidence: simulate a deploy (waiting SW) and show ONE gate end-to-end, driven as
      a real user through login — jsdom alone cannot prove this class of bug
