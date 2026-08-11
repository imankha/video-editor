# T6730 — Owner playback: clicking the Intro segment to seek back into the intro

**Tier:** M · **Layer:** Frontend · **Status:** WAITING ON USER (live verification pending — see Hardening pass)

## Report
On the owner in-app composite player (`IntroStoryPlayer`, built by T6710): after the
intro auto-continues forward into the reel, clicking the "Intro" segment on the
composite scrubber reportedly did "nothing — playback stays on the reel, the intro
card never re-appears." Kickoff repro used `document.querySelector('button[aria-label="Intro"]').click()`
+ an IMMEDIATE same-tick check of `document.querySelector('video')` / intro text.

## Investigation outcome — NOT a functional defect (measurement artifact)

Full evidence + Opus expert trace: [T6730-evidence.md](T6730-evidence.md).

Latent-since-T6710 (no commits touched the 5 relevant files since T6710 merged; T6710
is fully in master/STAGING, so the live env == the code tested here). Verified live
against the real repro account (imankh@gmail.com / 9fa7378c) with a photo-bearing card:

- A real positional / real-mouse click on the Intro segment **works** — region flips
  to intro in ~14–28ms (one frame), the reel `<video>` unmounts, MotionPreview mounts,
  the athlete name renders visibly, the seek lands at the clicked fraction (60% → 60%),
  and repeated clicks are honored (not deduped).
- The reported "nothing happens" is an artifact of the repro METHOD:
  1. React 18 batches the click handler's `setRegion`+`setIntroTimeMs` and commits on
     the next flush, so a **same-tick** check after `.click()` still sees the reel;
     one frame later it has switched (imperceptible to a human).
  2. A synthetic zero-coordinate `element.click()` gives `e.clientX=0` →
     `CompositeScrubber` fraction clamps to 0 → `seekIntro(0)` → the card mounts at the
     honest intro **t=0 pose**, where staggered text is still `opacity:0` (fades in over
     ~1s) → looks "blank" though it re-appeared.
  3. The reporter's `body.textContent` name-check is unreliable (the name is elsewhere
     in the DOM too).

No snap-back, no stale-rAF advance (the `tick` self-reschedule is cancelled by
`setPlaying(false)` cleanup + `playingRef` guard), no dedup drop, `endedFiredRef`
correctly re-armed on `seekIntro(<dur)`.

## Acceptance criteria (kickoff) — disposition
- [x] Clicking Intro after the reel started seeks back, intro content visibly showing — **already true** (Test A/C: name renders visible post-fade).
- [x] Clicking different points lands at different intro times (not always 0) — **already true** (60% click → 60%; "always 0" only occurs for a synthetic clientX=0 click).
- [x] Forward auto-continue still works — **unaffected / verified** (Test C re-arms 3×).
- [x] Repeated clicks not deduped — **already true** (Test C, 3 iterations).

## Deliverable
- No source change (code is correct).
- Added live regression guard `src/frontend/e2e/T6730-seek-back-to-intro.qa.spec.js`
  (3 tests, all green) — fills T6710's live-coverage gap for the auto-continue →
  backward-seek path and documents the artifact.

## Recommended follow-up (out of scope for T6730, surfaced by the adversarial reviewer)
`MotionPreview.jsx` (the playback intro renderer) has **no `<img> onError` handler**
(lines ~162-169): a card whose R2 photo 404s/dangles leaves `photoReady=false`
forever → a permanent skeleton during playback. The editor's `IntroCardRail.jsx`
(~266-270) already has the `onError`/`photoMissing` recovery (T6650) but it was not
carried into the playback component. This does NOT cause the reported region-switch
bug (text + card background still render, region still switches), but for a
photo-only card with a dangling object it could read as a "blank intro" during
playback. Recommend a small robustness task.

## Hardening pass (supervisor, 2026-08-11, post-worker)

The NO-FIX verdict above holds — no functional defect matching the original
report was found. Per the project owner's request, ran a deeper audit (Opus
expert consulted) of the same 5 files specifically for OTHER latent
weaknesses beyond the one already ruled out. Found 6; fixed/hardened 4,
flagged 2 as product decisions or too risky to auto-fix. Full theory writeup
+ confidence levels: see the expert consultation transcript referenced in
`.dotask-status` (2026-08-11T04:00 HARDENING line). Summary:

- **(A) Unclamped rAF `dt` — FIXED.** `useIntroPlayback.js`'s tick had no
  upper bound on the gap between frames. A backgrounded tab or a main-thread
  stall (the exact kind (F) below causes) could credit the entire hidden/stall
  duration to playback in one tick, fast-forwarding `introTimeMs` past
  `durationMs` and silently skipping the intro. Added a 250ms frame-gap budget
  (`FRAME_GAP_BUDGET_MS`) — an oversized gap is treated as a resume (no
  advance) with a `console.warn`, not a fast-forward. Also added a
  diagnostic-only warn when a backward seek lands within ~2 frames of the end
  (the "dead band" from (B)) — never auto-corrects, just proves the assumption
  broke if it's ever hit live.
- **(B) Dead-band click zone at the segment's tail — DIAGNOSTIC ONLY, not
  fixed.** A click landing in the last ~0.5-1% of the Intro segment's width
  (widened by (F)'s churn) seeks to a point so close to the end that
  auto-continue fires again almost immediately — the user perceives "nothing
  happened." The expert recommends against snapping the seek away from the
  literal clicked position (would make the bar lie about the timeline). Left
  as a `console.warn` for now; a real fix (pause-on-manual-seek, or a
  minimum-dwell affordance) is a product decision.
- **(C) Impure `setRegion` updater in `handleIntroEnded` — FIXED
  (mechanical, no behavior change).** The updater called `setReelsLanding`/
  `setLandingToken` as side effects inside a `setRegion` functional updater —
  React can invoke that function more than once for one real event (StrictMode
  dev double-invoke is live in this app; a Sync-lane click can also replay a
  still-pending Default-lane update). Currently harmless (the side effects are
  idempotent), but it's a standards violation sitting on the exact code path
  that already produced 3 prior real defects (T6710's Stage 4.5 review).
  Refactored to a `regionRef`-guarded plain callback.
- **(D) Auto-continue always lands at reel 0 / fraction 0 — FLAGGED, not
  fixed.** Clicking Intro from anywhere in the reels discards the user's
  actual reel/position (a product decision — should "rewatch the intro" keep
  your place?). Related cosmetic gap: a forward *scrub* past the intro (as
  opposed to auto-continue) never pins `introTimeMs` to `durationMs`, so the
  composite bar can show a stale partial fill for the Intro segment. Added a
  diagnostic `console.warn` for the cosmetic gap only — did not attempt the
  "pin the clock" fix, because it would route through `seekIntro`'s
  `fireEndedOnce` path and reintroduce a live version of (C)'s double-landing
  risk for this new call site.
- **(E) `CompositeScrubber`'s pointer-events wrapper created dead click zones
  — FIXED.** `IntroStoryPlayer`'s full-viewport overlay wrapped the ENTIRE
  bar row in `pointer-events-auto`, so the row's own padding, the `gap-1`
  gutters between segments, and the 1px intro/reel divider all silently
  swallowed clicks meant to fall through to the player underneath (and were
  themselves non-interactive, so those clicks did nothing). Moved
  `pointer-events-auto` off the row and onto each `<button>` individually;
  the divider and row padding are now `pointer-events-none` and pass clicks
  through. Not the reported bug (Playwright/mouse clicks target element
  centers), but a real dead zone for real users aiming at the row's edges.
- **(F) Font-settle window churns WAAPI animation rebuilds — FIXED.**
  `useCardPreviewElements`'s settle-window fallback called `compute()` fresh
  on every render while `state.key !== key` (e.g. `IntroPreRoll`'s
  `ResizeObserver` correcting `avail` shortly after mount), handing back a new
  `elements` array identity every time even though the underlying `key`
  hadn't changed between those renders. `MotionPreview`'s WAAPI build effect
  is keyed on that identity, so it tore down and rebuilt every animation
  (photo push-in, per-line fade-ups, flash) on every single render for the
  whole settle window (~100-750ms, per the settle logic's own
  `STABLE_FRAMES_REQUIRED`/`MAX_SETTLE_FRAMES` bounds) — main-thread churn
  exactly during the window where a user is asking "did my click do
  anything," and the amplifier behind (A)'s stall-triggered clock skip and
  (B)'s widened dead band. Fixed by memoizing the fallback with `useMemo`
  keyed on `key` (one-line root cause fix); added a rebuild-count canary
  `console.warn` in `MotionPreview` in case this regresses.

**Verification:** all 5 audited files eslint clean. Relevant unit suite:
65/65 (useIntroPlayback + IntroStoryPlayer + CompositeScrubber + MotionPreview
+ IntroPreRoll + CollectionPlayer — 2 new tests for the frame-gap guard and
dead-band warn, 3 pre-existing tests updated to drive multiple small ticks
instead of one oversized single-tick jump, since that jump is now correctly
clamped) + 47/47 (introCardPreviewElements + RichText). Build clean.

## Progress Log
- 2026-08-11: Read 5 files; confirmed latent-since-T6710. Built robust live repro
  (API attach dodges flaky kebab UI; dialog-scoped video). Positional + synthetic +
  real-mouse(×3) all show the backward-seek WORKS. Opus expert independently
  confirmed no defect. Relevant unit suite (29 tests) green. Wrote evidence doc.
  Set WAITING ON USER — cannot reproduce a functional defect; recommend supervisor
  close as not-a-bug or supply a sharper real-user repro.

## CI verdict
green — new e2e/T6730-seek-back-to-intro.qa.spec.js 3/3 pass; relevant unit suite
(IntroStoryPlayer/CompositeScrubber/useIntroPlayback/MotionPreview) 29/29 pass; no
source changed so no regression risk.
