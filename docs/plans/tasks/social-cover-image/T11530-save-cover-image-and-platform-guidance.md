# T11530: Save cover image + honest platform guidance

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-10-01
**Updated:** 2026-10-01

## Epic Context

This is task 2 of 5 in the Social Cover Image epic. Read [EPIC.md](EPIC.md), especially design
decisions 2 and 5. It depends on T11510, which creates the two separate share actions on the same
surfaces.

## Problem

When a video file is uploaded to Instagram Reels or Facebook, the platform picks the cover. No app
can preset it. Both platforms do let the person posting supply their own cover image:

- Instagram Reels: "Edit cover" -> "Add from camera roll"
- Facebook: custom thumbnail upload

Our users have no easy way to get the cover they chose in our app onto their phone's camera roll,
so they can't use that option.

Separately, the copy promises more than we deliver. The Cover image panel
(`ThumbnailPanel.jsx`, `EDITOR_PANELS.COVER_IMAGE_HELPER`) doesn't say where the cover applies, so
users reasonably expect it everywhere. That expectation is exactly what produced this bug report.

## Solution

1. **"Save cover image" action**, next to Share video / Share link on the result and My Reels
   surfaces. It serves the full-size poster JPEG:
   - On mobile: `navigator.share({files:[cover.jpg]})`. The iOS and Android sheets offer
     "Save Image" to Photos.
   - On desktop: a normal file download.

   Reuse the existing owner-facing poster serving in `downloads.py` (`_serve_reel_poster_jpeg`).
   Don't create a second poster object. If that function only serves the card-size thumbnail,
   expose the full-size `poster_rel_path` object behind the same owner auth.
2. **Accurate copy**:
   - In the Cover image panel, state that the cover is shown when the reel's **link** is shared
     (iMessage, WhatsApp, DMs, Facebook, X).
   - Add that when **uploading the video** to Instagram or TikTok, they choose a cover there. Point
     to "Save cover image" for Instagram's "Add from camera roll".
   - Add a short, dismissible hint after "Share video" with the same advice. Per the
     `frontend/CLAUDE.md` localStorage exception, the dismissed flag may be a per-device
     localStorage key that is written only by the dismiss gesture.

## Context

### Relevant Files
- `src/frontend/src/components/overlay/ThumbnailPanel.jsx`: helper copy.
- `src/frontend/src/config/displayNames.js`: `EDITOR_PANELS.COVER_IMAGE_HELPER`, new labels.
- `src/frontend/src/hooks/useWebShare.js`: add a `shareCoverImage` function, or put it in a
  sibling hook if it doesn't fit there.
- `src/frontend/src/components/PublishLinkFlow.jsx`, `PublishedReelsPanel.jsx`: add the action.
- `src/backend/app/routers/downloads.py`: the poster serving endpoint. Check its size and auth.
- `src/backend/app/services/poster.py`: `poster_rel_path`, `reel_card_poster_rel_path`.

### Related Tasks
- Depends on: T11510.
- Related: T6360 (cover art embedded in downloads), T6590 / T9550 (naming: the UI term is
  "cover image").

### Technical Notes
- Reels with no stored poster (legacy reels, or a failed generation) hide the action instead of
  serving a fallback. Follow the no-silent-fallback rule.
- The filename should be meaningful, e.g. `{reel name}-cover.jpg`.
- Copy rules: no em dashes. Don't claim automatic application on upload. Use "cover image", not
  "thumbnail" or "poster". Check against the AI-capability copy memory (no autonomous claims).

## Acceptance Criteria
- [ ] On a phone, "Save cover image" opens the share sheet with a JPEG that equals the stored
      full-size poster byte for byte (test the endpoint and the payload).
- [ ] Live-verified: the image saved to Photos can be picked in Instagram Reels "Add from camera
      roll".
- [ ] The action is hidden for reels with no poster.
- [ ] The Cover image panel copy names link previews as where the cover applies, and points to
      Save cover image for Instagram / TikTok uploads.
- [ ] The hint after "Share video" is dismissible, and the dismissal is written only by the
      dismiss gesture.
