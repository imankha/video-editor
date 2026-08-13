# T6960: Intro card photo must be ready before the intro clock starts

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-13
**Updated:** 2026-08-13
**Epic:** [intro bug fixes](EPIC.md)

## Problem

Staging report (2026-08-13, imankh@gmail.com): the attached card shows its image in the
carousel, but on in-app play the card often animates WITHOUT the photo — sometimes on
first play, sometimes on replay too ("I would assume it's cached locally").

Root cause, two layers:

1. **The clock never waits for the photo.** `useIntroPlayback` starts `playing=true` at
   mount (`useIntroPlayback.js:42`); `IntroStoryPlayer` mounts it immediately
   (`IntroStoryPlayer.jsx:127`). `MotionPreview` already skeletons the undecoded photo
   (`photoReady`, `MotionPreview.jsx:55/173-188`) but nothing holds the 4s animation —
   if the photo takes longer than the card, the viewer sees text over a skeleton, then
   footage.
2. **The browser cache cannot help.** Each Play fetches a fresh intro-playback payload
   whose `previewUrl` is a NEWLY presigned R2 URL (`intro_egress._presign_card_image` →
   `generate_presigned_url_global`) — the signature/expiry query params differ per
   request, so every play is a cache MISS and re-downloads the 1-2MB photo. That's why
   replay is flaky rather than reliably fixed: it re-races the network every time.

Same race exists on the edge share page: `renderIntroCard`'s CSS animations + hide-timer
start at parse (`functions/shared/[token].js:109-125`), regardless of the photo
`background-image` fetch.

## Solution

Gate the intro clock on image readiness, with a bounded wait (a broken/slow image
degrades to today's no-photo card after a cap — never a hang, always a console.warn):

1. New util `src/frontend/src/components/introcards/preloadIntroImage.js`:
   `preloadIntroImage(url, {timeoutMs = 2500})` → Promise resolving `'loaded' | 'error'
   | 'timeout' | 'no-image'`; uses `new Image()` + `decode()` (onload fallback for
   jsdom), always resolves, warns on error/timeout. Because it uses the SAME url string
   the subsequent `<img>` uses, the real render is then an instant cache hit.
2. `IntroStoryPlayer.jsx`: `introAssetsReady` state (initial `!intro?.previewUrl`);
   preload effect; the MAJOR-#3 play-gate effect (`:136-138`) becomes
   `setPlaying(region === 'intro' && introAssetsReady)`. Card holds at t=0 (treatment
   background + skeleton) until ready.
3. `IntroPreRoll.jsx` (share SPA self-driven path): same preload; the
   `useMotionPreviewAutoplay` `active` flag (`:73`) additionally requires readiness.
4. Edge share page (`functions/shared/[token].js`): photo animations + the hide-timer
   start only when a JS `Image()` preload of the photo resolves (load/error) or a 2500ms
   cap fires — gate by adding a `.play` class that the keyframe rules require
   (`#intro-card.play .ic-photo{animation:...}` etc.); no-photo cards get `.play`
   immediately. (Its SIZING bug is separate: [T6970](T6970-edge-share-intro-sizing.md).)

NOT in scope: making presigned URLs cache-stable (would need a backend proxy or longer
shared presigns — note for a future task if the extra per-play download matters on
mobile data).

## Context

### Relevant Files (REQUIRED)
- NEW `src/frontend/src/components/introcards/preloadIntroImage.js` (+ test)
- `src/frontend/src/components/introcards/IntroStoryPlayer.jsx` (~127-138)
- `src/frontend/src/components/introcards/IntroPreRoll.jsx` (~71-73)
- `src/frontend/functions/shared/[token].js` — `renderIntroCard` (~76-129)
- Tests: `IntroStoryPlayer.test.jsx`, `IntroPreRoll.test.jsx`, edge-page render test
  (grep `renderSharePage` in tests), new `preloadIntroImage.test.js`

### Technical Notes
- `useIntroPlayback` itself stays untouched — the hold is host-side via the existing
  `setPlaying` switch (the hook's rAF loop already tears down cleanly on false).
- The preload promise must be cancel-guarded in effects (`cancelled` flag) — a closed
  player must not setState.
- MotionPreview's own skeleton/`photoReady` stays — it is the mid-scrub guard; this task
  only stops the clock from running ahead of the first paintable frame.

## Acceptance Criteria
- [ ] With a throttled network (DevTools Slow 3G), first play holds the card at t=0
      until the photo appears, then plays it fully WITH the photo
- [ ] A 404 photo URL: card plays without photo after ~2.5s, console.warn, no hang
- [ ] Card with no photo: zero added delay
- [ ] Edge share page behaves the same (throttled + broken-photo checks)
- [ ] Relevant tests green; eslint clean
