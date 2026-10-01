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

1. **"Save cover image" action**, next to Share video / Share link on the draft result and
   published-highlight surfaces. It serves the full-size poster JPEG:
   - On mobile: `navigator.share({files:[cover.jpg]})`. The iOS and Android sheets offer
     "Save Image" to Photos.
   - On desktop: a normal file download.

   Reuse the existing owner-facing poster serving in `downloads.py` (`_serve_reel_poster_jpeg`).
   Don't create a second poster object. If that function only serves the card-size thumbnail,
   expose the full-size `poster_rel_path` object behind the same owner auth.
2. **Accurate copy**:
   - In the Cover image panel, state that the cover is shown when the highlight's **link** is shared
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
- Highlights with no stored poster (legacy highlights, or a failed generation) hide the action
  instead of serving a fallback. Follow the no-silent-fallback rule.
- The filename should be meaningful, e.g. `{highlight name}-cover.jpg`.
- Copy rules: no em dashes. Don't claim automatic application on upload. Use "cover image", not
  "thumbnail" or "poster". Check against the AI-capability copy memory (no autonomous claims).

## UI Decisions (UI Designer, 2026-10-01; layout delegated to the designer by the user)

These build on T11510's UI Decisions (`ShareActionSheet`, `ActionSheet`, the Toast fixes, and
`SHARE_ACTIONS`). Save cover image is a **tertiary** action everywhere. Only someone posting the
file to Instagram needs it, so it never competes with Share link or Share video for emphasis.

### D1. Gate (when "Save cover image" exists at all)

It renders only when **both** of these hold:
- **The highlight has a stored cover image.** This needs a read-only boolean on the highlight row and the
  draft payload (e.g. `has_cover_image`), folded into the existing reads. Don't use a HEAD probe
  or the tile's `<img>` 404. Without a cover the action is hidden, never a fallback (technical
  note above).
- **The device can perform it.** On coarse pointers that means
  `navigator.canShare({files:[new File([''], 'x.jpg', {type:'image/jpeg'})]})` is true. This is a
  separate probe from the MP4 one, because some LINK_ONLY devices can share images. On fine
  pointers it is a normal download.

Payload: `navigator.share({ files: [coverJpeg] })` with **no** `title`/`text`/`url`, so iOS and
Android lead with "Save Image" / "Save to Photos" rather than treating it as a message. The
filename is `{highlight name}-cover.jpg`. Success shows no toast and no chip. AbortError is silent.
Any other error shows `toast.error('Could not get the cover image')`.

### D2. Placement per surface

| Surface | Placement | Spec |
|---|---|---|
| `ShareActionSheet` (published highlight player Share, tile card-face Share, kebab "Share...") | 4th row, in the "post the video" group, right after Share video | Row per T11510 D1: `ImageDown` icon, label `SHARE_ACTIONS.SAVE_COVER_IMAGE`, hint `SHARE_ACTIONS.SAVE_COVER_IMAGE_HINT`. Busy: `Loader` + "Preparing cover image...", other rows disabled; the sheet closes on resolve/AbortError |
| Draft result, `ready` and `ready-capable` (mobile) | Below the `SHARE_CHOICE_HINT` caption, in the slot T11510 D6 reserved | `<Button variant="ghost" size="sm" icon={ImageDown} fullWidth className="text-gray-300 coarse-pointer:min-h-11">Save cover image</Button>` |
| Draft result, `idle` / `review` / `publishing` | Not shown | Matches T11510 D8: the idle phase is unchanged |
| Draft result, desktop link-ready | Below `LinkReadyCard`, same ghost button | Downloads the JPEG |
| ReelTile desktop kebab popover | New item directly after Download | `menuItemClass`, `ImageDown size={18}`, downloads the JPEG |
| ReelTile mobile kebab | Not added | Reached via "Share..." -> chooser (T11510 D4) |
| Post-export toast | Not added | The highlight is unpublished at that moment, and the toast has no share action on coarse pointers (T11510 D5) |
| Post-Share-video hint (D3) | The hint's action | See D3 |

Rationale: it always sits next to Share video, the action it supports, and is visually quieter
than both share actions.

Draft result with Save cover image (390px):

```
+------------------------------------------+
| Link ready                               |
| +--------------------------------------+ |
| | reelballers.com/shared/k3J9...  [cp] | |
| +--------------------------------------+ |
| +------------------+ +-----------------+ |
| | [link] Share link| |[share] Share    | |
| |      (cyan)      | |  video (gray)   | |
| +------------------+ +-----------------+ |
| Share link for texts and DMs. Share      |
| video to post on Instagram or TikTok.    |
|        [img] Save cover image            |   ghost, full width, min-h-11
+------------------------------------------+
```

### D3. Post-"Share video" hint

- **Component:** the existing Toast (`toast.info`). The tip has to work after Share video on every
  surface, including the chooser, which has closed by the time the share finishes. The global toast is the only component present on all of them. Two Toast
  extensions are needed (the T11510 D5 fixes ship first):
  - `duration: 0`. It does not auto-dismiss, so the tip waits for the user to come back from
    Instagram (Android resolves `navigator.share` the moment a target is picked).
  - A new `onUserDismiss` callback, fired **only** from the X tap or the action tap, never from
    the auto-timer or a programmatic `toast.dismiss`.
  - `dedupKey: 'cover-image-tip'`, so repeated shares never stack it.
- **When:** after `shareVideoFile` **resolves**, from any surface, if D1's gate passes for that
  highlight and the flag is not set. It never shows after AbortError or an error, and never after Share
  link.
- **Where:** the toast stack, bottom of the screen; full width minus 16px insets at 360-428px (per
  the T11510 D5 container fix).
- **Dismissal:** tapping **X** (`aria-label` / `title` "Dismiss tip") or tapping the action
  ("Save cover image") writes `localStorage['rb.share.coverImageTipDismissed'] = '1'` inside that
  gesture's handler (frontend/CLAUDE.md T10850 exception). The flag is read in the Share video
  success handler, never in an effect. After the user handles the tip once, it never returns;
  the chooser hints and the Cover image panel keep the advice available.
- **Copy:** title `SHARE_ACTIONS.COVER_TIP_TITLE`, message `SHARE_ACTIONS.COVER_TIP_BODY`, action
  `SHARE_ACTIONS.SAVE_COVER_IMAGE` with `icon: ImageDown`.

```
+------------------------------------------+
|  ...app...                               |
| +--------------------------------------+ |
| |(i) Want your cover image on      [x] | |   x = "Dismiss tip", 44px
| |    Instagram?                        | |
| |    Instagram and TikTok pick their   | |
| |    own cover for uploaded videos. On | |
| |    Instagram, tap Edit cover, then   | |
| |    Add from camera roll, and choose  | |
| |    your cover image.                 | |
| |    [img] Save cover image            | |   action, min-h-11
| +--------------------------------------+ |
+------------------------------------------+
```

Rationale: it shows at the moment the user is about to post. It names only the action the user
takes themselves and claims nothing automatic. The one action it offers gets them the file.

### D4. Cover image panel copy (`ThumbnailPanel.jsx`)

- `COVER_IMAGE_HELPER` is a `title` tooltip on the heading today, invisible on touch. **Remove the
  tooltip** and render the guidance as visible text in a footer block under the existing feedback
  caption:

```jsx
<div className="space-y-1.5 border-t border-gray-700 pt-3">
  <p className="text-xs text-gray-300">{EDITOR_PANELS.COVER_IMAGE_HELPER}</p>
  <p className="text-xs text-gray-400">{EDITOR_PANELS.COVER_IMAGE_UPLOAD_NOTE}</p>
</div>
```

- Also drop the duplicated instruction in `autoLabel`. It becomes `Auto-picked · 0:12`, because
  the caption right below already says "Drag the marker on the timeline to choose the cover
  frame."

```
+------------------------------------------+
| Cover image                              |
| Frame you picked · 0:12                  |
| +--------------------------------------+ |
| |          (cover frame preview)       | |
| +--------------------------------------+ |
| Drag the marker on the timeline to       |
| choose the cover frame.                  |
| ---------------------------------------- |
| Shows when you share your highlight's    |
| link, like in iMessage, WhatsApp, DMs,   |
| Facebook and X.                          |
| Posting the video to Instagram or        |
| TikTok? Those apps pick a cover, and you |
| can change it there. Use Save cover      |
| image when you share, then pick it in    |
| Instagram's Add from camera roll.        |
+------------------------------------------+
```

Rationale: it says where the cover does apply (link previews), says honestly that uploads pick
their own cover, and names the exact button and Instagram path that close the gap.

### D5. Labels: `displayNames.js`

Add to `SHARE_ACTIONS` (created by T11510):

```js
  SAVE_COVER_IMAGE: 'Save cover image',
  SAVE_COVER_IMAGE_HINT: 'Use it as your cover in Instagram.',
  SAVE_COVER_IMAGE_PREPARING: 'Preparing cover image...',
  SAVE_COVER_IMAGE_FAILED: 'Could not get the cover image',
  COVER_TIP_TITLE: 'Want your cover image on Instagram?',
  COVER_TIP_BODY: 'Instagram and TikTok pick their own cover for uploaded videos. On Instagram, tap Edit cover, then Add from camera roll, and choose your cover image.',
  COVER_TIP_DISMISS: 'Dismiss tip',
```

Change in `EDITOR_PANELS`:

```js
  COVER_IMAGE_HELPER: "Shows when you share your highlight's link, like in iMessage, WhatsApp, DMs, Facebook and X.",
  COVER_IMAGE_UPLOAD_NOTE: "Posting the video to Instagram or TikTok? Those apps pick a cover, and you can change it there. Use Save cover image when you share, then pick it in Instagram's Add from camera roll.",
```

Add `RESULT_PUBLISH.SAVE_COVER_IMAGE: SHARE_ACTIONS.SAVE_COVER_IMAGE`. Analytics:
`track('share_initiated', { method: 'cover_image', source })`.

Copy audit: no em dashes; it says "cover image", never thumbnail or poster. It claims no automatic
cover on upload. There is no "Saved" copy, and nothing says "saved". Vocabulary (user, 2026-10-01): the
finished product is a "highlight" (a "highlight clip" or a "highlight reel", where a reel is a
collection of highlight clips). Copy never calls a single finished highlight a "reel". "Instagram
Reels" and "Facebook Reels" are the platforms' own product names and stay.

## Acceptance Criteria
- [ ] On a phone, "Save cover image" opens the share sheet with a JPEG that equals the stored
      full-size poster byte for byte (test the endpoint and the payload). The payload carries
      `files` only: no `title`, `text` or `url`.
- [ ] Live-verified: the image saved to Photos can be picked in Instagram Reels "Add from camera
      roll".
- [ ] The action is hidden for highlights with no poster (driven by a data field, not a 404 probe), and
      hidden on coarse pointers that fail the JPEG `canShare` probe.
- [ ] "Save cover image" appears as the 4th `ShareActionSheet` row, as the ghost button under the
      draft link-ready grid, and in the desktop kebab after Download; it is NOT in the mobile
      kebab or the post-export toast.
- [ ] The Cover image panel shows the two lines of guidance (D4) as visible text, with no
      tooltip-only copy; it names link previews as where the cover applies, and points to Save
      cover image for Instagram / TikTok uploads.
- [ ] The hint after "Share video" appears only after a resolved Share video (not AbortError, not
      Share link), only when Save cover image is available for that highlight, and never stacks
      (dedupKey).
- [ ] The hint is dismissible, and the dismissal is written only by the dismiss gesture (X or its
      action); the auto-timer path cannot write it (test with `duration: 0` and with a forced
      `toast.dismiss`).
- [ ] All new mobile controls meet the 44px floor, with no horizontal overflow at 360px.
