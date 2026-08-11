# T6740: Intro replay UX decisions (auto-continue landing position + tail dead-band click)

**Status:** STAGING (both decisions closed; nothing further to implement)
**Impact:** 3
**Complexity:** 2
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

T6730's hardening-pass audit of the owner in-app composite player
(`IntroStoryPlayer.jsx` / `CompositeScrubber.jsx` / `useIntroPlayback.js`)
found two real, reproducible UX gaps in the intro-replay surface. Neither is
a defect in the sense T6730 investigated (both are fully deterministic, not
races) — they were deliberately left as diagnostic-only `console.warn`s
rather than auto-fixed, because both require a product/UX call the AI
shouldn't make silently. Full technical detail and the audit's reasoning
live in T6730's "Hardening pass" section
([T6730-owner-playback-seek-back-to-intro-broken.md](T6730-owner-playback-seek-back-to-intro-broken.md))
— this task doesn't duplicate that, only the decisions themselves and their
options.

**This task cannot proceed to implementation until the user picks an option
for each decision below** (or explicitly says "leave as-is" for one or
both, which is itself a valid, sufficient answer).

### Decision D — auto-continue always lands at reel 0 / fraction 0

`IntroStoryPlayer.jsx`'s `handleIntroEnded` hardcodes the landing as
`{ index: 0, fraction: 0 }` every time the intro finishes — whether that's
the very first natural play-through, or the intro finishing again after a
user manually clicked back to rewatch it. Either way, whatever reel/position
the user was actually watching before is discarded; "rewatch the intro"
silently rewinds the whole reel sequence to the start.

The data needed to preserve position already exists and is already flowing
into this component: `reelProgress = { activeIndex, segmentProgress }`,
fed by `CollectionPlayer`'s `onProgress` callback — it's just never
consulted for this landing decision today.

### Decision B — dead-band click at the tail of the Intro segment

`CompositeScrubber.jsx`'s click handler computes
`fraction = (clientX - rect.left) / rect.width`, clamped to `[0, 1]`. A
click landing in roughly the last 0.5-1% of the Intro segment's width seeks
so close to the intro's own duration that the forward auto-continue (in
`useIntroPlayback.js`) fires again within about 2 real-time frames — from
the user's perspective, clicking near the right edge of the Intro segment
does nothing perceptible; it auto-continues back to the reels before they
register the switch.

An Opus expert consulted during T6730 explicitly recommended against
silently snapping a near-1.0 fraction away from what was actually clicked —
that would make the scrubber lie about the real timeline position for a
literal, deliberate click. Any fix needs to change *when auto-continue is
allowed to fire*, not *where the seek lands*.

## Options

### For D
1. **Preserve position** — snapshot `reelProgress` when `region` leaves
   `'reels'`; use it (instead of the hardcoded `{0, 0}`) as the landing on
   the next `handleIntroEnded`. "Rewatch the intro" resumes where you left
   off.
2. **Keep restarting at reel 0** — current behavior; do nothing. Simplest,
   and defensible if "rewatch the intro" is meant to also restart the
   highlight reel as a fresh viewing.

### For B
1. **Minimum dwell floor** — after any manual backward seek into the intro,
   hold on the intro for a fixed minimum duration (e.g. 1s) before
   auto-continue is allowed to fire, regardless of where exactly the seek
   landed. Simple, but means a seek to 99% doesn't behave like a seek to 99%
   used to (intentionally — that's the point).
2. **Dwell floor measured from click position** — same idea as (1), but the
   floor is relative to the clicked fraction rather than a fixed wall-clock
   amount, so the "you get at least N seconds of visible intro" guarantee
   scales with how deliberately close to the end the user clicked.
3. **Bias the hit target, not the seek** — leave `seekIntro`'s precision
   alone, but give `CompositeScrubber`'s Intro cell a "safe" inner
   sub-region for hit-testing that's biased away from its literal edges, so
   an intentional click near the visual middle of the segment can't
   accidentally resolve to a fraction that lands in the dead band. Doesn't
   fully eliminate the dead band (a deliberate edge click can still find
   it) but shrinks how easy it is to hit by accident.
4. **Accept it** — the dead band is a genuine but narrow edge case (⪅1% of
   the segment's width); leave the diagnostic warn as the only signal and
   do nothing behaviorally.

**No recommendation is being forced here** — see the artifact/design writeup
shared alongside this task for a fuller comparison; the call is the user's.

## Context

### Relevant Files
- `src/frontend/src/components/introcards/IntroStoryPlayer.jsx` — `handleIntroEnded`, `region` state, `reelProgress` (decision D)
- `src/frontend/src/components/introcards/CompositeScrubber.jsx` — `handleClick`, fraction computation (decision B)
- `src/frontend/src/components/introcards/useIntroPlayback.js` — `seekIntro`, `fireEndedOnce`, the existing dead-band diagnostic warn (decision B)

### Related Tasks
- Follows: [T6730](T6730-owner-playback-seek-back-to-intro-broken.md) (hardening-pass audit that surfaced both decisions; see its "Hardening pass" section for full technical detail, confidence levels, and why these were diagnostic-only rather than auto-fixed)
- Epic: [player-intro](EPIC.md)

### Technical Notes
- Both decisions are independent of each other and of T6730's actual bug
  investigation — implementing one does not require implementing the other.
- Whichever option is picked for B, do NOT change `CompositeScrubber`'s
  fraction math or clamp behavior for clicks outside the Intro segment (the
  reel segments) — this task is scoped to the Intro segment's own tail
  behavior only.
- If D's "preserve position" option is picked, reuse `reelProgress` as-is
  rather than introducing a second position-tracking mechanism — it already
  updates live off `CollectionPlayer`'s existing `onProgress` callback (see
  T6710's original design for why that callback exists).

## Implementation

### Steps
1. [x] User picks an option for D (or "leave as-is") — **Option 2, leave as-is**, chosen 2026-08-11
2. [x] User picks an option for B (or "leave as-is") — **Option 1, minimum dwell floor**, chosen 2026-08-11
3. [x] Implement whichever options were picked — B implemented; D is "leave as-is", nothing to implement
4. [x] Tests for the picked behavior(s) — B's dwell mechanism covered; D needs none (no behavior change)
5. [x] Remove or adjust the now-superseded diagnostic `console.warn`s — the dead-band warn in `useIntroPlayback.js`'s `fireEndedOnce` removed (superseded by the dwell fix itself). D never had its own diagnostic warn in code (checked `IntroStoryPlayer.jsx` directly during closeout — the only `console.warn` there is the unrelated stale-`introTimeMs`-on-leaving-intro check); nothing to remove for D

### Progress Log

**2026-08-11**: Task filed, spun out of T6730's hardening-pass audit. Design decisions D and B documented above with options; awaiting user's call via the accompanying design artifact. No implementation started.

**2026-08-11 (later same day)**: User reviewed the Decision B artifact and approved the recommendation — **Option 1 (minimum dwell floor)**. Implemented in `useIntroPlayback.js`: `seekIntro` now records a wall-clock deadline (`dwellUntilRef`, `performance.now() + 1000ms`) whenever a seek lands short of `durationMs`; the rAF `tick` holds `introTimeMs` frozen at the seeked pose (no advance, no frame-gap evaluation) while `now < dwellUntilRef.current`, resyncing `lastFrameTimeRef` every held frame so the existing frame-gap guard (T6730 finding A) doesn't false-positive the instant the dwell clears. The old dead-band diagnostic (`DEAD_BAND_MS`, `lastBackwardSeekRef`) is removed — the mechanism it warned about is now structurally prevented rather than just logged. 3 new/updated unit tests (dwell holds the pose near the end; the floor is unconditional, applying even to a seek far from the end; a direct seek to `durationMs` itself still fires immediately, no dwell) — 67/67 relevant unit tests green, eslint clean, build clean. Decision D remains open — no recommendation was made for it and the user hasn't weighed in yet.

**2026-08-11 (session 3)**: Design artifact published for Decision D (mechanism diagram, before/after scenario table showing the decision only diverges on the manual-replay path, two-option comparison, no forced recommendation per the task's own framing). User's call: **Option 2, leave as-is** — `handleIntroEnded`'s hardcoded `{ index: 0, fraction: 0 }` landing stays exactly as it is today. No code change, no new tests. Both T6740 decisions are now closed; task moves to STAGING (B's implementation is already on master via PR #253/#254).

## Acceptance Criteria

- [x] Decision D has an explicit answer (preserve position / keep restarting at reel 0) and, if changed, is implemented + tested — **Option 2, leave as-is**, chosen 2026-08-11; no code change, nothing to test
- [x] Decision B has an explicit answer (Option 1: minimum dwell floor) and is implemented + tested
- [ ] No regression to T6710/T6730's existing behavior (seek-back-into-intro itself, forward auto-continue, `landingToken` dedup) — relevant unit suite green; live/e2e re-verification still pending before this can be checked off
