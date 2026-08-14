# T7030: Intro card image doesn't load; scrubbing back to it leaves the video blank

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-08-14
**Updated:** 2026-08-14

## Problem

User report 2026-08-14 while testing on staging: playing a reel whose intro card has a photo,
the image doesn't render. Separately: playing past the intro into the reel, then scrubbing back
to the intro segment, leaves the video area **blank** (no image, no video, nothing playing).
HAR provided: `Downloads/reel-ballers-staging.pages.dev.har`.

## What the HAR confirms

The session covers browsing My Reels, then landing on download id 8 (a reel with an intro
card) around `16:39:08`. The exact sequence at that moment:

```
16:39:08.947  GET  /api/downloads/8/stream   -> status 0 (network-level abort, 3.7ms — cancelled
                                                 almost instantly, not a slow timeout)
16:39:08.948  PATCH /api/downloads/8/watched -> 200
16:39:08.951  GET  /api/downloads/8/stream   -> 404 Not Found (28-byte JSON body, no body text
                                                 captured in the HAR)
```

So the reel's own final-video stream endpoint returns a clean 404 on the SECOND attempt,
immediately after the FIRST attempt was cancelled client-side. A 404 on `/downloads/{id}/stream`
is exactly consistent with "the video just stops blank" — there's no valid source for the
`<video>` element to play.

**Separately, and more surprising**: there is no corresponding intro-card image request
anywhere near this timestamp at all. The only R2 fetch for an intro image in the whole capture
happened much earlier (`16:38:40.716`, right after boot/bootstrap, 200 OK, 2.24MB `image/png`)
— unrelated to the actual scrub-back moment the user describes. **This means when the user
scrubbed back to the intro segment, no new image request was even attempted** — the failure to
render is not a failed fetch, it's the component not re-requesting/re-mounting the image at all.
This points at a stale-ref or unmount/remount gap in the composite scrubber's intro rendering,
not a network problem for the image specifically.

## Hypotheses (unconfirmed — need live investigation)

- **A — `/downloads/8/stream` 404 is a real backend bug**: the reel's final video reference may
  be missing/stale for this specific download, OR the request-cancel-then-retry pattern
  (status-0 abort immediately followed by a fresh request) races against some state update and
  the retry fires with a wrong/stale id or before the video is actually ready server-side.
- **B — the composite scrubber doesn't correctly reset/remount on scrub-back into the intro
  segment.** This app has hit this general bug class before on the SAME component family:
  T6860 ("multiple cards during playback" / stale content-hash), T6870 (scroll/reveal state),
  and the underlying `CompositeScrubber`/`IntroStoryPlayer`/`MotionPreview` trio (T6710's
  composite-scrubber timeline work) is exactly where a "scrub backward across a region boundary"
  bug would live — check whether the intro `<img>`/`MotionPreview` mount is keyed in a way that
  survives a forward-then-backward scrub, and whether `useIntroPlayback`'s region-flip logic
  (T6730's hardening pass touched this exact file for a related backward-seek issue) has a gap
  specifically for the VIDEO side canceling its stream request without a clean re-fetch on
  return to the intro side.

## Context

### Relevant Files
- `src/components/introcards/CompositeScrubber.jsx` — timeline scrub UI, region boundaries
- `src/components/introcards/IntroStoryPlayer.jsx` — orchestrates intro vs. reel region playback
- `src/components/introcards/MotionPreview.jsx` — renders the intro card (image/motion)
- `src/frontend/src/hooks/useIntroPlayback.js` (T6730 hardening pass touched this — frame-gap
  clamp, dead-band warn, `regionRef`-guarded region flip — read that history first)
- `src/backend/app/routers/downloads.py` — `/downloads/{id}/stream` and `/downloads/{id}/watched`
- HAR evidence: `Downloads/reel-ballers-staging.pages.dev.har` (user-provided, not committed —
  ask the user to re-share if needed)

### Related Tasks
- Follows the same component family as T6710 (composite scrubber timeline), T6730 (backward-seek
  hardening pass — found 6 latent weaknesses in these same 5 files, none matching this exact
  report), T6860/T6870 (multiple prior bugs in this same intro-playback surface)

### Technical Notes
- Not urgent/blocking — this is playback-only, no data loss, no write path involved.
- Reproduce with a real account + a reel that has an intro card with a photo (not text-only) to
  rule out a photo-specific vs. any-card codepath.

## Acceptance Criteria
- [ ] Root cause identified for the `/downloads/8/stream` 404 on the second (retry) request
- [ ] Root cause identified for why no image request fires on scrub-back into the intro segment
- [ ] Playing an intro card with a photo shows the photo, consistently
- [ ] Scrubbing forward past the intro then back into it resumes correctly (image or video
      visible, never a blank frame)
- [ ] Regression test added pinning the scrub-forward-then-backward-into-intro sequence
- [ ] Tests pass
