# Social Cover Image: make the cover the user picked show up on social platforms

**Status:** TODO
**Priority:** HIGH (user-ordered 2026-10-01)
**Started:** -
**Impact:** 8 | **Complexity:** 5

## Goal

The user picks a cover image in Spotlight (the "Cover image" panel; `poster_*` in the data model).
They expect every social platform to show that cover. On 2026-10-01 they posted a highlight to Instagram
twice, once through the PWA's Share button and once by downloading the file and uploading it. Both
times Instagram showed a cover it picked itself.

When this epic is done, every path from our app to a social platform does one of the following:

- shows the user's cover automatically, where the platform lets anyone set it,
- gives the user a one-tap way to supply it themselves, where the platform only accepts a cover
  from the person posting, or
- says honestly that the platform chooses its own cover, where nothing can set it.

## Findings (expert investigation 2026-10-01, verified against code)

**Both reported failures were the same failure.** On a phone, `useWebShare.webShare` has FULL
capability (coarse pointer and `canShare({files})`; `useWebShare.js:64-75`). It then fetches
`GET /api/downloads/{id}/file` and calls `navigator.share({files:[mp4]})` with **no URL**
(`useWebShare.js:118-126`). So Share and Download hand Instagram exactly the same bytes. No crawler
ever runs, so our `og:image` never gets a chance.

**The cover image is already embedded in the file, and platforms ignore it there.**
T6360 (`download_metadata.py:215-266`, called from `downloads.py` `_stamp_download`) adds the
poster JPEG as an `attached_pic` stream (the `covr` atom). That atom is read by Finder, QuickTime
and some gallery apps. Instagram, TikTok, Facebook, X, WhatsApp and iOS all transcode the upload
and pick their own thumbnail. The default is the **first video frame**, or a frame near it.

Today, frame 0 is the first frame of the intro card when the highlight has one, and otherwise
the highlight's first frame. The chosen cover is normally a frame in the middle of the slow-mo section
(`poster.py::select_poster_frame`), so it almost never matches frame 0.

**Link shares already use the cover.** `functions/shared/[token].js:199-236` emits these tags:

- `og:image`: the stable poster proxy, i.e. the user's chosen frame
- `og:video`
- `twitter:card=summary_large_image`

iMessage, WhatsApp, Instagram DM, Facebook link posts, X and Messenger render `og:image`.

**The mobile share paths never send a link.** The draft result's button is labelled
"Share link..." (`RESULT_PUBLISH.SHARE_LINK`, `PublishLinkFlow.jsx:88-89`), but it calls the same
`webShare` and sends the **file** (`DraftReelPreview.jsx:237-252`). The published-highlight tile
kebab, the player Share button (`PublishedReelsPanel.jsx:638, :677`) and the post-export toast
(`GlobalExportIndicator.jsx:234`) also send only the file on mobile.

So on a phone, the native share sheet cannot send the one kind of payload that would carry the
user's cover.

### Per-platform map (link vs uploaded file)

| Platform / surface | Shared LINK | Uploaded FILE |
|---|---|---|
| Instagram feed / Reels | No link posts exist | Defaults to frame 0. The user can change it with "Edit cover", including **Add from camera roll** |
| Instagram Stories | Link sticker is a text chip; can't be controlled | Plays from frame 0; there's no cover concept |
| Instagram DM | Shows `og:image` (ours) | Frame 0 |
| TikTok | No link unfurl in posts | Defaults to frame 0, and the user can pick a frame. Custom image upload varies by client |
| Facebook feed / Reels | Shows `og:image` (ours) | Suggests several auto-picked frames, and the user can upload a custom thumbnail |
| X | Shows `twitter:image` (ours) | Frame 0, or a frame the user picks |
| Snapchat | Basic card | Frame 0 |
| WhatsApp | Shows `og:image` (ours), but it fails silently on large images or slow fetches | Frame 0, from the sender's device |
| iMessage | Shows `og:image` (ours). Plain SMS shows a bare URL | Thumbnail is taken from early frames |

The per-platform behaviour comes from platform knowledge, not a test. T11540 confirms the
upload-side column before T11550 builds anything on it.

## Design decisions (apply to every task)

1. **A file and a link are two different shares, so they get two different actions.** The file is
   for *posting* (Reels, TikTok, Stories). The link is for *messaging* (iMessage, WhatsApp, DM),
   and it carries our cover. No mobile button may send one while its label names the other.
2. **There are exactly three ways to get the cover onto a platform:**
   - `og:image`, for link shares
   - a cover image the *user* supplies in the platform's own cover picker (Instagram Reels
     "Add from camera roll", Facebook custom thumbnail)
   - **frame 0** of the uploaded file, which is the default cover on most platforms

   The `covr`/`attached_pic` embed is NOT a way. Keep it for Finder and Photos, and don't extend it.
3. **No platform posting APIs.** This rules out Instagram Graph `cover_url` and the TikTok Content
   Posting API. Both need business or creator accounts, app review and OAuth, which is
   disproportionate for this.
4. **Changing the delivered video is a user decision.** Putting the cover in front as frame 0
   shows a visible still before the content, so it is not an invisible change (see the memory note
   on invisible quality-neutral optimizations). It is gated on T11540's results AND on the user
   explicitly approving it.
5. **Copy must not overclaim.** Never say or imply that Instagram, TikTok or Facebook use the cover
   automatically for an uploaded video. Name where the cover does apply: link previews, plus covers
   the user sets themselves. No em dashes in shipped copy.
6. **Publishing is the visibility decision** (user decisions 2026-10-01). `createShareUrl` mints
   an `is_public: true` token.
   - A **published** highlight gets its link directly, with no review step (T10180 R5 stands).
   - An **unpublished** highlight gets a link only through T10180's existing "Publish and get
     link" review, and **cannot be shared as a video file** before publishing.
   - Desktop Copy link needs no confirm step.
7. **Vocabulary** (user, 2026-10-01). The finished product is a **highlight**: either a
   **highlight clip** (one play) or a **highlight reel** (a collection of highlight clips).
   Copy never calls a single finished highlight a "reel". "Instagram Reels" and "Facebook Reels"
   are the platforms' product names and stay. Code identifiers (`ReelTile`,
   `PublishedReelsPanel`, `final_videos`) keep their names; renaming existing app-wide "Reels"
   labels is outside this epic.

## Tasks

Row order is the sequence. Within an epic, order follows dependencies. T11540 is run by the user
on real phones and has no code dependency, so it can start any time, in parallel with the others.

| ID | Task | Tier | Status |
|----|------|------|--------|
| T11510 | [Separate "Share video" and "Share link" on mobile](T11510-split-share-video-vs-share-link.md) | M | TODO |
| T11530 | [Save cover image + honest platform guidance](T11530-save-cover-image-and-platform-guidance.md) | M | TODO |
| T11520 | [Harden share-link unfurls for real crawlers](T11520-harden-share-link-unfurls.md) | M | TODO |
| T11540 | [Experiment: does frame 0 set the default cover on upload?](T11540-frame0-cover-upload-experiment.md) | S (human-run) | TODO |
| T11550 | [Lead the delivered file with the chosen cover (conditional)](T11550-lead-file-with-cover-frame.md) | L | TODO (blocked: T11540 + user approval) |

## Out of scope

- Collection downloads have no cover (`build_collection_metadata` sets `cover_path: None`).
  Collections have no single poster. File a separate task if wanted.
- Instagram Stories' link sticker and plain-SMS link rendering. Neither can be controlled.

## Completion Criteria

- [ ] On a phone, the user can choose between sharing the video and sharing the link, and each
      label matches what it sends
- [ ] Sending a highlight link into iMessage, WhatsApp and Instagram DM shows the chosen cover (live-verified)
- [ ] The user can save the cover image to their phone in one tap and use it in Instagram's
      "Add from camera roll"
- [ ] The Cover image panel and share flow say accurately where the cover applies
- [ ] T11540's results are recorded, and the user has made the T11550 go/no-go call
- [ ] `export-pipeline.md` updated (share payload types, cover-image levers)
