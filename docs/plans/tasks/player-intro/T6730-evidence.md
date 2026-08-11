# T6730 — investigation evidence (worker, 2026-08-11)

## Task
Bug report: clicking the "Intro" segment on the composite scrubber (owner in-app
player, `IntroStoryPlayer`) AFTER the intro has auto-continued forward into the
reel does nothing — "playback stays on the reel, the intro card never re-appears."
Confirmed-live repro uses `document.querySelector('button[aria-label="Intro"]').click()`
+ an IMMEDIATE same-tick check of `document.querySelector('video')` (present) and
intro text (absent).

## Files in play (no commits since T6710 merged — bug is latent, not a regression)
- src/frontend/src/components/introcards/IntroStoryPlayer.jsx  (region state, onScrub, handleScrubberScrub, setPlaying(region==='intro'))
- src/frontend/src/components/introcards/useIntroPlayback.js   (rAF clock, seekIntro, fireEndedOnce, endedFiredRef)
- src/frontend/src/components/introcards/CompositeScrubber.jsx (bar; handleClick computes fraction from e.clientX - rect.left)
- src/frontend/src/components/introcards/MotionPreview.jsx     (WAAPI, currentTimeMs-driven; text fades up from opacity 0 over the first ~1s)
- src/frontend/src/components/collections/CollectionPlayer.jsx (reels; unmounts when region==='intro')

## Live findings (real account imankh@gmail.com / profile 9fa7378c, card "T6670 inline-create QA card", dur 4s)

### Test A — Playwright positional click at 60% of the Intro segment, AFTER auto-continue + 1.5s settle
PASSES. Region switches to intro, player `<video>` unmounts, MotionPreview mounts,
scrubber intro fill lands at 60.1% and advances to 70% (clock running). Screenshot
qa/T6730-backward-seek-landed-in-intro.png shows "Mehdi Khabazian" rendered. => the
feature WORKS for a real positional click.

### Test B — EXACT kickoff repro: synthetic `btn.click()` immediately after auto-continue, multi-frame probe
```
before-click : dialogVideo=1 motionPreview=0 introFill=100% bodyHasName=true
sync-same-tick: dialogVideo=1 motionPreview=0 introFill=100% bodyHasName=true   <-- NO synchronous change
after-1-frame: dialogVideo=0 motionPreview=1 introFill=0%   bodyHasName=true   <-- region DID switch, 1 frame later
after-5-frame: dialogVideo=0 motionPreview=1 introFill=0.745%                    (clock advancing from 0)
```
Notes:
- `bodyHasName` is TRUE in every snapshot (the athlete name lives elsewhere in the
  DOM too), so the reporter's "intro text absent" signal is unreliable.
- The synthetic zero-coordinate `.click()` gives `e.clientX=0` -> `fraction` clamps
  to 0 -> seekIntro(0) -> lands at t=0 where MotionPreview text is still faded out
  (screenshot qa/T6730-exact-after-synthetic-click.png: gold card, no visible name).

### Test C -- REAL mouse gesture (page.mouse.click), no settle, repeated x3
PASSES x3. Each iteration clicks the intro at 40% immediately after auto-continue:
```
iter 0: region switched after ~17ms; name present + a text slot VISIBLE (opacity>0.5)
iter 1: region switched after ~17ms; name present + visible slot
iter 2: region switched after ~28ms; name present + visible slot
```
A real human-equivalent click switches region within ~1 frame every time, the intro
content renders visibly after fade-in, and REPEATED clicks are not deduped.

## VERDICT (worker + Opus expert agent, independent): NO FUNCTIONAL DEFECT

The expert traced all five files and concluded the code is correct:
- The "1 frame later" switch is benign React 18 batching. `onScrub` runs inside a
  React synthetic-event handler; `setRegion(INTRO)` + `setIntroTimeMs` (via
  seekIntro) are batched and committed on the next flush -- `.click()` returns
  before React commits, so a same-tick DOM read sees the stale reel. A human sees
  the switch in the same paint (<16ms). Confirmed by Tests A/C (~14-28ms).
- No region snap-back. After a backward scrub sets INTRO nothing sets REELS again;
  the only REELS-setter (`handleIntroEnded`) is guarded by `endedFiredRef` + a
  `current !== INTRO` check.
- The stale self-rescheduling rAF in `tick` (useIntroPlayback.js:104) is real but
  harmless: when region leaves 'intro', `setPlaying(false)` cleanup cancels the rAF
  and `playingRef=false` makes any in-flight tick no-op; it cannot advance the clock
  or re-fire ended. `seekIntro(<dur)` re-arms `endedFiredRef=false` (line 55).
- No dedup drop -- `landingToken` only gates the reels->goTo path, not the backward
  INTRO seek; `seekIntro` has no dedup (Test C's repeated clicks confirm).
- The reporter's `bodyHasName` signal is unreliable (name is elsewhere in the DOM);
  the "blank card" is the synthetic `clientX=0` click landing at the honest intro
  t=0 pose. The expert recommends AGAINST snapping fraction-0 to an epsilon (would
  make the scrubber lie about timeline position -- violates "correct data, not
  workarounds").

T6710 (which owns this code, incl. its later forward-auto-continue + landingToken
fixes) is fully merged into master and deployed to STAGING -- the environment the
human tested is the same code tested here.

## Outcome
No source change. Added a live regression guard (e2e/T6730-seek-back-to-intro.qa
.spec.js, 3 tests green) filling T6710's live-coverage gap for the auto-continue ->
backward-seek path, plus documenting the artifact. Surfacing to the supervisor:
could not reproduce a functional defect; strong evidence the report is a
measurement artifact of the synthetic-click repro method. Recommend the supervisor
either close T6730 as not-a-bug or provide a sharper real-user repro.
