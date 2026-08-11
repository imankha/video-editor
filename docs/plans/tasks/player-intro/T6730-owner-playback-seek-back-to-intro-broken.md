# T6730 — Owner playback: clicking the Intro segment to seek back into the intro

**Tier:** M · **Layer:** Frontend · **Status:** WAITING ON USER (supervisor adjudication — see Outcome)

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
