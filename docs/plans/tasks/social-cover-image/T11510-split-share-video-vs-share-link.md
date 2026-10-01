# T11510: Separate "Share video" and "Share link" on mobile

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-10-01
**Updated:** 2026-10-01

## Epic Context

This is task 1 of 5 in the Social Cover Image epic. Read [EPIC.md](EPIC.md), especially design
decisions 1, 5 and 6.

## Problem

On a phone, every Share entry point sends the raw MP4 file and never a link. That includes the one
labelled "Share link...". `useWebShare.webShare` has FULL capability (`useWebShare.js:64-75`), so
it fetches `/api/downloads/{id}/file` and calls `navigator.share({files:[mp4]})` with no `url`
(`useWebShare.js:118-126`).

A file never shows our chosen cover: Instagram, iMessage, WhatsApp and the rest pick their own
thumbnail from the video. A link unfurls with `og:image`, which is the cover the user picked. So
mobile users cannot send the one payload type that respects their cover. The draft button's label
also says the opposite of what it does.

## Solution

On coarse-pointer devices, give the user two explicit actions instead of one hidden choice:

- **Share video**: `navigator.share({ title, text, files:[mp4] })`. This is today's FULL branch.
  Use it for posting to Reels, TikTok and Stories.
- **Share link**: `navigator.share({ title, text, url: shareUrl })`. Use it for messaging. It
  unfurls with the chosen cover.

Split `webShare` into two intent-named functions, for example `shareVideoFile` and `shareLink`,
rather than picking a payload by capability:

- `shareLink` needs only `navigator.share`, which LINK_ONLY devices also have.
- `shareVideoFile` needs FULL.

Desktop behaviour (ShareModal / Copy link) is unchanged.

## Context

### Relevant Files
- `src/frontend/src/hooks/useWebShare.js`: split `webShare`. Keep the T7350 pointer-capability
  gate; never sniff the user agent (memory: share UA-sniff landmine, broken twice).
- `src/frontend/src/components/PublishLinkFlow.jsx` (L87-90): the link-ready "Share link..."
  button must call the link share. Add a "Share video" sibling.
- `src/frontend/src/components/DraftReelPreview.jsx` (L237-252): rewire `handleNativeShare`.
- `src/frontend/src/components/PublishedReelsPanel.jsx` (L630-696): add both actions to the kebab
  and the player Share.
- `src/frontend/src/components/collections/ReelTile.jsx`: the kebab routes through
  PublishedReelsPanel.
- `src/frontend/src/components/GlobalExportIndicator.jsx` (L209-234): the post-export toast
  action. Decide whether it is "Share video" or opens the choice (see Open Questions).
- `src/frontend/src/config/displayNames.js` (L203, `RESULT_PUBLISH.SHARE_LINK`): add the labels.
- Tests: `useWebShare.test.js`, `DraftReelPreview.test.jsx`, `PublishedReelsPanel.intro.test.jsx`.

### Related Tasks
- Blocks: T11530 (adds a third, cover-image action to the same surfaces).
- Builds on: T10180 (publish -> visibility-review -> link-ready flow), T7350 (pointer gate).

### Technical Notes
- **Visibility landmine (EPIC decision 6):** `createShareUrl` POSTs `is_public: true`, which makes
  the reel publicly reachable.
  - On a reel that is already Shared, "Share link" may mint or reuse the token directly.
  - On a Private reel, "Share link" must route through T10180's visibility-review confirm.
  - "Share video" sends a file and needs no token, so it doesn't change visibility.
- `navigator.share` with BOTH `files` and `url` behaves differently per target app (Messages sends
  both; Instagram drops the url). Don't combine them. Keep the two payloads separate.
- AbortError (the user closed the sheet) stays silent, as today.
- The `inflightShareUrl` dedup stays shared by `copyLink`, `createShareLink` and `shareLink`.

## Open Questions (ask the user, with a decision artifact showing both layouts)
1. Post-export toast: should its single Share button be "Share video", or open a two-option sheet?
2. Should the My Reels player show two buttons, or one Share button that opens a two-option chooser?

## Acceptance Criteria
- [ ] On a coarse-pointer device with file sharing, "Share video" calls `navigator.share` with
      `files` and no `url`, and "Share link" calls it with `url` and no `files`. Unit tests assert
      the exact payload for each.
- [ ] A LINK_ONLY device shows "Share link" and doesn't show "Share video".
- [ ] "Share link" on a Private reel goes through the visibility review; it never POSTs
      `is_public:true` without that confirm (test).
- [ ] No label on any surface names a payload different from the one it sends.
- [ ] Live-verified on a real phone: Share link -> iMessage shows the chosen cover frame in the
      preview card.
- [ ] Desktop ShareModal / Copy link behaviour unchanged.
