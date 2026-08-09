# T6710: Owner in-app playback intro as a real timeline segment

**Status:** TODO
**Impact:** 6 | **Complexity:** 7
**Epic:** [Player Intro + Rich Text](EPIC.md)
**Follows:** [T6700](T6700-owner-inapp-playback-intro.md) — owner in-app playback intro (swap-based)

## Problem

User feedback after T6700 landed (2026-08-09): the intro currently plays as a separate, bolted-on
pre-roll — `DownloadsPanel.jsx` unmount/mount-swaps `IntroPreRoll` for `CollectionPlayer` until
`onDone`, per T6700's design. Visually and interactively this reads as a "commercial before the
video," not part of it: there's no single scrubber spanning both, you can't seek backward from the
reel into the intro, and the two are structurally two different mounted components glued together
by a timer/callback, not one timeline.

Explicit end goal from the user: "without burning the intro card [into the video file], seems just
like a part of the video" — the intro should be a real segment on the SAME playback timeline as the
reel, not a separate screen.

## Scope decision (2026-08-09, user-directed)

Two things the user explicitly deferred rather than decided now, to manage risk/velocity while
T6680+T6700 were mid-merge and already waiting on retest:

1. **Player surface: owner in-app player ONLY for this task.** T5220's share-page intro is a
   separately-built hand-rolled DOM intro on the Cloudflare edge function — a different tech stack
   (no React player, no shared component tree). Unifying that too is a natural follow-up, not
   bundled here, so each task stays independently reviewable.
2. **Depth: real seekable segment, not just a visual marker.** A marker-only scrubber (shade the
   first N seconds, no seek support) does not achieve "feels like part of the video" — the
   stated goal requires actually being able to scrub back into the intro and have it resume
   correctly, which is a materially different (bigger) build than a cosmetic overlay.

## Solution (needs an Architecture design pass — do not implement directly)

Two known candidate approaches, real tradeoffs between them, needs a design doc before either is
picked:

- **A. Physical concatenation, one `<video>` source.** Reuse the `ffmpeg_concat.py` helper T5220
  already extracted (originally for the owner-download burn-in path) to produce a single
  intro+reel media file for in-app playback too, so the native `<video>` element's own scrubber
  covers both halves for free — real seeking, real single timeline, no custom scrubber code.
  Costs: an extra transcode/cache step for a path that previously served the raw reel directly
  (latency, storage, cache invalidation whenever the card or reel changes — unlike the
  already-final download/share artifacts, an in-app "Play" click has always been the LIVE current
  state, so this may fight the resolve-at-play-time contract T5220 built collection playback on).
- **B. Virtual composite timeline, two sources kept separate.** Keep `IntroPreRoll` (DOM/
  `MotionPreview`) and `CollectionPlayer`'s `<video>` as two distinct renderers, but build a
  custom unified scrubber component that maps a single virtual playhead across both durations,
  switching which one is actually mounted/playing as the playhead crosses the boundary (extending,
  not replacing, T6700's swap — the swap becomes scrubber-driven instead of only forward/auto).
  Costs: real UI complexity (a custom scrubber, boundary-crossing edge cases, keeping both
  duration sources in sync), but no transcode cost and no staleness risk — always plays current
  state.

The design doc should also settle: does seeking *within* the intro itself (e.g. scrubbing partway
through the intro's own text-element animation) need to work, or is the intro atomic (seek always
lands you at intro-start when you land in that region)? And whether this changes the resolved-intro
payload shape `GET /api/downloads/{id}/intro-playback` (T6700) already returns.

## Context

### Relevant Files
- `src/frontend/src/components/DownloadsPanel.jsx` — T6700's swap lives here (`storyPlayer`
  render); whichever approach is picked, this is the entry point
- `src/frontend/src/components/collections/CollectionPlayer.jsx` — the shared `<video>` player;
  approach A doesn't need to touch it, approach B needs a scrubber wrapper around/instead of its
  native controls
- `src/frontend/src/components/introcards/IntroPreRoll.jsx` — current DOM pre-roll (approach B
  keeps this; approach A replaces its playback role with baked-in video frames, though the
  component may still matter for something else — check before assuming it's dead)
- `src/backend/app/services/ffmpeg_concat.py` — T5220's extraction from `branded_outro.py`/
  `player_intro.py`; the concat primitive approach A would reuse
- `src/backend/app/services/intro_egress.py` (`resolve_intro_for_reel`, `mode="playback"`) —
  existing resolver both approaches still need for "which card, if any, applies to this reel"

### Related Tasks
- [T6700](T6700-owner-inapp-playback-intro.md) — the swap-based owner playback intro this task
  upgrades; read its design doc (`docs/plans/tasks/T6700-design.md`) first, this task's approach B
  is explicitly an extension of it, not a replacement
- [T5220](T5220-add-intro-integration.md) — origin of `ffmpeg_concat.py` (approach A's dependency)
  and the resolve-at-play-time contract for collection playback (approach A's main risk)

## Classification hint
L-tier: genuine architecture decision with real tradeoffs (transcode-and-cache vs. virtual
composite scrubber), touches shared playback infrastructure — needs the Architecture design gate,
matching T6680/T6700's own precedent.

## Acceptance Criteria
- [ ] Playing a reel or collection (owner, in-app) that has an intro shows ONE continuous timeline/
      scrubber spanning intro + content, not two separately-mounted screens.
- [ ] The playhead moves continuously across the intro-to-content boundary with no visible seam
      (matches T6700's existing auto-continue requirement, now generalized to a real timeline).
- [ ] Seeking within the content portion works normally, unaffected.
- [ ] Design doc explicitly states and justifies whether seeking backward into the intro portion
      is supported, and if so, verifies it actually works.
- [ ] Reels/collections with no intro attached are completely unaffected (single plain timeline,
      same as today).
