# T16420: Share the video file from a published highlight

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** A published highlight's Share buttons (on its player, on its tile, and in the tile's menu on a phone) all open the Share dialog, which shares a link and is private by default. To post the video itself to Instagram Reels or TikTok, a parent has to tap Download, find the file and upload it in the other app.

**The problem and how we got here.** T11510 (written 2026-10-01) planned a phone sheet with two choices, Share video and Share link. On 2026-10-18 T13120 changed those Share buttons to the private-by-default dialog, because the old phone share made a public link with no choice. On 2026-11-13 the owner ruled T11510's sheet superseded by T13120 and asked for this task: bring back Share video on published highlights without undoing the private default. Of the 56 parents who paid for a highlight, 11 downloaded or shared it, so every extra step here costs shares.

**What we will do.** On a phone that can share files, add a "Share video" choice to the published highlight's Share dialog that hands the video file to the phone's share sheet (Reels, TikTok, Messages). Share link stays exactly as T13120 made it, private by default. While the file is being prepared, show "Preparing video..." with a spinner. A phone that cannot share files sees no Share video.

**Why.** Posting the highlight is what brings other parents and coaches to see it; a link preview is for messaging, a file is what Reels and TikTok take.

**How we will know it worked.** On a phone, Share video from a published highlight opens the share sheet with the video file and no link; Share link still shows the visibility choice; the share-or-download rate out of paid highlights on the admin Journey moves.

## Implementer details

- Share dialog: `src/frontend/src/components/ShareModal.jsx` (no `navigator.share` today). Callers: `PublishedReelsPanel.jsx` (`webShareReel`, `sharePlayerReel`) and `ReelTile.jsx`.
- File sharing helper from T11510: `useWebShare`'s `shareVideoFile` (and `shareLink`), with its LINK_ONLY detection.
- Keep T13120's default: Share video must never mint or change a public link.

## Acceptance Criteria

- [ ] On a coarse-pointer device that can share files, the published highlight's Share dialog offers "Share video", which calls `navigator.share` with `files` and no `url` (test asserts the payload).
- [ ] Share video never creates a link or changes the highlight's visibility (test).
- [ ] A LINK_ONLY device does not see Share video in the dialog (test).
- [ ] While the file is prepared the button shows "Preparing video..." with a spinner and the dialog's other actions are disabled; it ends on success or AbortError and shows an error on any other failure (test).
- [ ] Desktop Share dialog behaviour is unchanged.
