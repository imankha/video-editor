# Fast App Update (speed up new version load)

**Status:** TODO
**Created:** 2026-09-09 (user request, during the Annotate walkthrough)
**Started:** -

## Goal

Cut the wall-clock between "a new build is live on the server" and "the user is running it" from
minutes to seconds, without reintroducing a blocking interstitial and without reloading anyone
mid-work.

T8460 removed the blocking wall and made the update silent. T9310 then narrowed three specific
stalls. Nobody has ever MEASURED the end-to-end latency, and the remaining cost is structural rather
than a tuning constant, which is why this is an epic and not one more gap fix.

## Where the time actually goes

Three legs, in order. Each child owns one.

```
  deploy lands            client notices          bundle downloaded        new code running
       |                       |                        |                        |
       +---- TIME TO NOTICE ---+---- TIME TO FETCH -----+--- TIME TO ACTIVATE ---+
              T9360                    T9370                     T9380
```

1. **Time to notice.** A waiting bundle never self-activates: `registerType: 'prompt'` plus a
   deliberately no-op `onNeedRefresh` means the ONLY activator is
   `checkServerVersion -> requireUpdate -> runUpdate` (`utils/appVersion.js:91`). That fires on an
   API response, the on-load `GET /api/version`, or the return-to-app poll - all throttled by
   `UPDATE_CHECK_MIN_GAP_MS` = 5 minutes. T9310's Part 1 verdict recorded the honest consequence: for
   an idle tab making no API calls and never tab-switching, **the window is effectively unbounded**.
   It called that "acceptable in steady state". This epic revisits that judgement, because the user
   has now asked for it to be fast.

2. **Time to fetch.** The service worker precaches the new build before it can become `waiting`.
   Nobody has looked at how much a one-line change actually re-downloads, or whether the chunking
   makes a small deploy a small download. On a phone on cellular this leg can dominate the other two
   put together.

3. **Time to activate.** `skipWaiting` -> `controllerchange` -> full page reload, with a 3.5s Safari
   escalation to a manual bust-and-reload (`SW_ACTIVATE_TIMEOUT_MS`). Plus whatever the quiescence
   condition adds, which after T9310's Gap A now includes ~5s of pointer/key idle.

## Already done, do not redo

T9310 (STAGING, merged 2026-09-09) shipped:

- **Gap A**: `isQuiescent` also requires ~5s of input idle, so a reload no longer lands mid-scrub.
- **Gap B**: a 2s interval re-tests quiescence while an update is pending, so a deferred update
  resumes with no new API traffic.
- **Gap C**: `probeForWaitingBundle` returns `{ hasBundle, stillInstalling }`; a "no" caused only by
  a slow install re-probes after ~30s instead of the full 5-minute lockout.
- **Gap D**: explicitly DEFERRED - no auto-retry of `flush-verify`, because a failure there can be a
  genuine CAS refusal and CLAUDE.md forbids blind-retrying a write path. The manual Retry stays.

Every child below must build on that, not re-litigate it.

## Children (strict order)

| # | Task | Owns |
|---|------|------|
| 1 | [T9340](T9340-version-update-latency-investigation.md) | Measure all three legs. Gate for the rest. |
| 2 | [T9360](T9360-shrink-time-to-notice.md) | Time to notice |
| 3 | [T9370](T9370-shrink-update-download.md) | Time to fetch |
| 4 | [T9380](T9380-shrink-time-to-activate.md) | Time to activate |

**T9340 gates the other three.** Its deliverable is a number per leg on two profiles (a warm desktop
tab, and a mobile PWA resumed from background). Whichever leg dominates gets implemented first; the
other two may be dropped outright if the measurement says they are noise. Do not start 2, 3, or 4
before 1 reports.

## Invariants (apply to every child)

- **No blocking interstitial, ever.** T8460 deleted the wall on purpose. Nothing here brings back a
  modal the user has to dismiss.
- **Never reload a user mid-work.** T9310's Gap A input-idle condition is a floor, not a ceiling.
  Making the update faster must not make it more intrusive - "fast" means the update is READY
  sooner, not that it interrupts sooner.
- **No blind retry of a write path.** `flush-verify` failures stay a surfaced gesture (Gap D
  decision, and CLAUDE.md's persistence rule).
- **No reactive persistence.** Nothing added here may be a `useEffect` that watches state and writes.
- **Real service workers or it did not happen.** `e2e/T6230-update-gate-real-sw.spec.js`
  (`npm run test:e2e:sw-gate`) serves two genuinely different builds from a self-owned origin. Every
  claim in this epic is proved there, not in a mock.

## Related

- T8460 - the silent update itself (STAGING, not yet on prod: prod was on build 4290, T8460 landed in
  4437). The next prod deploy shows existing users the OLD wall exactly once, per T9310's verdict.
- T9310 - the three gaps above, plus the Part 1 stale-client verdict.
- T8570 - initial-load performance investigation. ADJACENT, not the same thing: T8570 is about how
  long the app takes to become usable on a cold visit; this epic is about how long a NEW BUILD takes
  to reach a user who already has the app. They may share findings about bundle size and chunking
  (T9370 especially), so check T8570's results before starting that child.
