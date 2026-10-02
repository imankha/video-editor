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
  action. Decided: no share action on coarse pointers (see UI Decisions D5).
- New: `src/frontend/src/components/shared/ActionSheet.jsx`, `src/frontend/src/components/ShareActionSheet.jsx`
  (UI Decisions D1). Touched: `src/frontend/src/components/shared/Toast.jsx` (D5),
  `LinkReadyCard.jsx` (D6), `collections/CollectionPlayer.jsx` (D2, Share tap target).
- `src/frontend/src/config/displayNames.js` (L203, `RESULT_PUBLISH.SHARE_LINK`): add the labels.
- Tests: `useWebShare.test.js`, `DraftReelPreview.test.jsx`, `PublishedReelsPanel.intro.test.jsx`.

### Related Tasks
- Blocks: T11530 (adds a third, cover-image action to the same surfaces).
- Builds on: T10180 (publish -> visibility-review -> link-ready flow), T7350 (pointer gate).
- Related, no dependency either direction: [T11590](../T11590-cache-composed-download-serve.md)
  caches the server-side compose this task's "Share video" action waits on. T11590 does not
  eliminate the wait on a cache miss - if live testing after both ship still shows "Share video"
  failing silently (iOS dropping the share-sheet user-activation on a long first-ever compose),
  apply the same second-tap pattern this task already uses for link-minting (D3).

### Technical Notes
- **Visibility landmine (EPIC decision 6):** `createShareUrl` POSTs `is_public: true`, which makes
  the highlight publicly reachable. User decisions 2026-10-01:
  - A **published** highlight mints or reuses the token directly, with no review (T10180 R5).
  - An **unpublished** highlight gets a link only through T10180's existing "Publish and get
    link" review, and never offers "Share video".
  - Desktop Copy link needs no confirm step.
- `navigator.share` with BOTH `files` and `url` behaves differently per target app (Messages sends
  both; Instagram drops the url). Don't combine them. Keep the two payloads separate.
- AbortError (the user closed the sheet) stays silent, as today.
- The `inflightShareUrl` dedup stays shared by `copyLink`, `createShareLink` and `shareLink`.

## UI Decisions (UI Designer, 2026-10-01; layout delegated to the designer by the user)

All decisions apply to coarse pointers only (`useIsCoarsePointer`, never a UA sniff). Fine-pointer
UI (ShareModal, Copy link, desktop kebab popover) is untouched. T11530 adds "Save cover image" to
the same surfaces; its row/slot is reserved here so T11530 is additive.

### D0. Capability gates (what each device sees)

| Device | Share link | Copy link | Share video | Save cover image (T11530) |
|---|---|---|---|---|
| FULL (`canShare({files:[mp4]})`) | yes | yes | yes | yes, if the highlight has a cover |
| LINK_ONLY (`navigator.share`, no file share) | yes | yes | **hidden** | only if `canShare({files:[jpeg]})` passes |
| Coarse pointer, no `navigator.share` | **hidden** | yes | **hidden** | hidden |

Hidden means not rendered, never rendered disabled. Rationale: the user only sees actions their
device can actually perform.

### D1. One shared chooser: `ShareActionSheet` (new) on a new `ActionSheet` shell (new)

No reusable action sheet exists. The bottom-sheet markup is hand-copied three times already
(`DraftTile.jsx:893`, `ReelTile.jsx:396`, `GameTile.jsx:433`), and all three close on a backdrop
tap, which breaks the house rule. This chooser would be the fourth copy, so per Refactoring
Rule 1 it is extracted:

- `src/frontend/src/components/shared/ActionSheet.jsx`: presentational shell only. It is portaled
  to `document.body` at `Z.SHARE` (`z-[200]`, above `Z.PLAYER` and `Z.TOAST`), the backdrop is
  **inert**, Escape closes it, and it has one explicit bottom control (Cancel / Done). Its shape
  is modelled on `RateThisPlayModal.jsx`, which already has an inert backdrop.
- `src/frontend/src/components/ShareActionSheet.jsx`: the share rows plus the in-sheet
  link-making and link-ready views (D3). It is the **only** mobile owner of link-minting logic
  outside the draft result.
- Migrating the three existing kebab sheets onto `ActionSheet` is a separate follow-up task
  (mechanical move, kept apart from this behavior change). The exception is ReelTile's mobile
  kebab, which this task already edits, so it is fixed here (see D4).

```jsx
// ActionSheet shell
createPortal(
  <div role="presentation" data-testid="action-sheet-backdrop"
       className={`fixed inset-0 ${Z.SHARE} flex items-end justify-center bg-black/60`}>
    {/* backdrop is inert: no onClick (house rule) */}
    <div role="dialog" aria-modal="true" aria-labelledby={headingId}
         className="w-full max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-gray-700
                    bg-gray-800 shadow-xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-600" />
      <h2 id={headingId} className="px-4 pt-3 pb-1 text-base font-semibold text-white truncate">{title}</h2>
      <div className="px-2 py-1">{children}</div>
      <div className="px-4 pt-2">
        <Button variant="secondary" fullWidth onClick={onClose} className="min-h-11">{closeLabel}</Button>
      </div>
    </div>
  </div>, document.body)

// ShareActionSheet row (one per action). min-h-14 keeps two-line rows well above 44px.
<button type="button" className="w-full flex items-center gap-3 px-3 py-2.5 min-h-14 rounded-lg
        text-left hover:bg-gray-700 active:bg-gray-700 disabled:opacity-50 transition-colors">
  <Icon size={20} className="text-gray-300 shrink-0" />            {/* Loader + animate-spin while busy */}
  <span className="min-w-0 flex flex-col">
    <span className="text-sm font-medium text-gray-100">{label}</span>
    {hint && <span className="text-xs text-gray-400">{hint}</span>}
  </span>
</button>
// Group divider between the link rows and the file rows:
<div className="my-1 mx-3 border-t border-gray-700" />
```

The rows are in two groups: **send the link** first (Share link, Copy link), then **post the
video** (Share video, then T11530's Save cover image). Icons: `Link2` (Share link), `Copy` (Copy
link), `Share2` (Share video), `ImageDown` (Save cover image, T11530).

**Busy and outcome:** while the MP4 is fetched, the Share video row swaps its icon for a
`Loader`, its label reads "Preparing video...", and every row is disabled. When `navigator.share`
resolves, or rejects with AbortError, the sheet closes silently. On any other error it shows
`toast.error('Share failed')` and the sheet stays open. Success never produces a toast or a
"saved"/"shared" chip; the OS sheet is the confirmation.

Mockup (published highlights list, a highlight that already has a public link, FULL device, 390px):

```
+------------------------------------------+
|     (player / highlights list, dimmed)   |
+------------------------------------------+
|                  ----                    |
| Share "Rangers U12 Goal vs Sharks"       |
|                                          |
| [link]  Share link                       |
|         For texts and DMs. Most chat     |
|         apps show your cover image.      |
| [copy]  Copy link                        |
|  --------------------------------------  |
| [share] Share video                      |
|         For posting to Instagram Reels,  |
|         TikTok or Stories.               |
| [img]   Save cover image      (T11530)   |
|         Use it as your cover in          |
|         Instagram.                       |
| +--------------------------------------+ |
| |                Cancel                | |
| +--------------------------------------+ |
+------------------------------------------+
```

Rationale: one component, used by every mobile Share entry point, gives one place for link minting
and the capability logic. It also fits rows with explanatory hints at 360px, which no
toolbar can.

### D2. Published highlight player (`PublishedReelsPanel`): keep ONE "Share" button, which opens `ShareActionSheet`

- `CollectionPlayer`'s header already holds Share, Download, Re-edit, Re-rank, Play/Pause,
  Fullscreen and Close (`CollectionPlayer.jsx:513-600`). Two or three labeled share buttons
  cannot fit at 390px without overflow.
- `sharePlayerReel` (`PublishedReelsPanel.jsx:673`) opens the sheet on coarse pointers. Fine
  pointers keep copy-link.
- The button keeps its label "Share" (`SHARE_ACTIONS.SHARE`) and `Share2` icon, and gains
  `coarse-pointer:min-h-11`. Today it has no 44px floor (unlike the Publish button beside it).

Rationale: Share stays the player's single primary verb (T8540), and the choice happens one tap
later, where there is room to explain it.

### D3. Making the link inside the sheet (EPIC decision 6, as narrowed by the user 2026-10-01)

**User decision 2026-10-01:** T10180 R5 stands. A highlight that is already **published** gets
its link with no review step, because publishing was the visibility decision. The review step
exists only on the draft result's idle path ("Publish and get link"), for highlights that are
still private, and it is unchanged. Everything the chooser opens on is published (`PublishedReelsPanel`
lists published highlights only), so **the chooser has no review view.**

When the highlight has **no active public link yet**, tapping Share link or Copy link mints the
link directly (`createShareLink`). The view shows `Loader` and "Making link...", then the
**link-ready view**:

```
| Link ready                               |
| +--------------------------------------+ |
| | reelballers.com/shared/k3J9...  [cp] | |   LinkReadyCard (selectable input + Copy)
| +--------------------------------------+ |
| +--------------------------------------+ |
| |        [link]  Share link            | |   cyan, fullWidth, min-h-11
| +--------------------------------------+ |
| +--------------------------------------+ |
| |                 Done                 | |   ActionSheet close control
| +--------------------------------------+ |
```

- Share link is a **second tap** on purpose. After awaiting the mint POST, iOS Safari can drop
  the transient user activation `navigator.share` needs. A fresh tap guarantees it, and the
  draft result's T10180 link-ready phase works the same way.
- Copy link, when it had to mint, copies as soon as the mint resolves (clipboard writes don't
  need the share sheet's user activation) and shows the ready view with the link.
- The bottom control reads "Cancel" in the list view, and "Done" in the ready view.
- When the highlight **already has** an active public link, Share link calls `shareLink` directly
  and Copy link copies directly. There is no ready view.
- **Data dependency:** the sheet needs to know whether a public link exists. Add a read-only
  boolean (e.g. `has_public_link`) to the existing published-highlights member read. Fold it into the current
  query, the way T10860 folded `stale_share` into `GET /api/projects`: no new fetch and no effect.
  Until the field is true, link actions take the mint-then-ready path. This adds a backend layer
  to this task, which is still tier M.

Rationale: the extra tap happens only the first time a highlight gets a link, and only because
iOS needs a fresh tap to open the share sheet.

### D4. Published highlight tile (`ReelTile`): card face and kebab

- **Card-face "Share"** (`ReelTile.jsx:359`, T8540): unchanged visually. On coarse pointers,
  `onWebShare` opens `ShareActionSheet` instead of sending the file.
- **Mobile kebab sheet:** the separate "Share" and "Copy Link" rows (`ReelTile.jsx:413-420`) are
  replaced by **one** row, `Share2` "Share...". It closes the kebab and opens `ShareActionSheet`.
  Save cover image is NOT added to the kebab, because it lives in the chooser. The desktop
  popover is unchanged.
- While this sheet is being edited, its backdrop `onClick` (`ReelTile.jsx:398`) is removed and a
  final full-width `Cancel` row is added (`Button variant="secondary" fullWidth className="min-h-11"`).
  The same violation in `DraftTile` and `GameTile` goes to the follow-up `ActionSheet` migration
  task.

```
Kebab sheet (390px)            ->   ShareActionSheet (D1)
| [dl]    Download          |
| [share] Share...          |  --tap-->  closes kebab, opens the chooser
| [spark] Intro             |
| ...                       |
| [trash] Delete            |
| [        Cancel         ] |
```

Rationale: a single owner for share and link logic, a shorter kebab, and no sheet stacked on
another sheet. The card-face Share is still one tap from the chooser.

### D5. Post-export toast: no share action on coarse pointers

`GlobalExportIndicator.jsx:228-254`:

- When the export completes, the highlight is an **unpublished draft**. **User decision
  2026-10-01:** an unpublished highlight cannot be shared as a video file, and a link needs the
  publish review, which doesn't belong in an 8-second toast.
- **Coarse pointer (any capability):** remove today's Share action (it sends the file). The toast
  carries no share action. Sharing happens from the draft result surface after publishing.
- **Fine pointer:** unchanged. **User decision 2026-10-01:** desktop Copy link needs no confirm
  step, so there is no follow-up task.
- **Toast component fixes**, still needed by T11530's tip (`components/shared/Toast.jsx`):
  1. `action.icon` option. The action currently always shows `ExternalLink`. The default stays
     `ExternalLink` for existing callers.
  2. Add `coarse-pointer:min-h-11` to the action button. It is a bare text link today, below
     44px.
  3. The container (`fixed bottom-4 right-4 max-w-sm w-full`) overflows the left edge by 16px
     at 360px. Change it to `fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-full max-w-sm`.

Rationale: the toast must not offer an action the user's decisions rule out for an unpublished
highlight.

### D6. Draft result, link-ready phase (`PublishLinkFlow` `phase==='ready'`, coarse pointer)

Layout, top to bottom, inside the existing `flex flex-col gap-2 px-3 py-2`:

1. "Link ready" (`text-sm font-medium text-white`, unchanged).
2. **`LinkReadyCard` on mobile too.** Today mobile shows only the button. The selectable URL plus
   Copy is the clipboard fallback and is useful for pasting into a bio. Its Copy button gains
   `coarse-pointer:min-h-11 coarse-pointer:min-w-11 inline-flex items-center justify-center`
   (it is about 22px today).
3. **Two-up grid** `grid grid-cols-2 gap-2`:
   - `Button variant="cyan" size="sm" icon={Link2} className="w-full coarse-pointer:min-h-11"`
     "Share link". This is the primary, because this flow exists to make the link.
   - `Button variant="secondary" size="sm" icon={Share2} className="w-full coarse-pointer:min-h-11"`
     "Share video".
   - LINK_ONLY: the grid collapses to a single full-width Share link.
4. One caption `text-xs text-gray-400`: `RESULT_PUBLISH.SHARE_CHOICE_HINT`.
5. T11530's Save cover image goes in a reserved slot below the caption (see T11530 D2).

```
+------------------------------------------+
| (CollectionPlayer video)                 |
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
|        [img] Save cover image  (T11530)  |
+------------------------------------------+
```

Width check: 390 - 24 padding - 8 gap gives 179px per button, and 360 gives 164px. The widest
content, an icon plus "Share video", is about 126px.

**`ready-capable` (already published, no link yet) on mobile:** the same layout, minus the URL
card. Share video works at once (it needs no token, and the highlight is published). **Share link
mints the link directly with no review (T10180 R5, upheld by the user 2026-10-01)**, then moves to
`ready`, where Share link is the second tap.

Also, `PublishLinkFlow`'s idle and review buttons ("Publish and get link", Cancel, "Publish and
create link") gain `coarse-pointer:min-h-11` while this file is being edited. They have no 44px
floor today.

Rationale: the draft result's action bar has full width, so both actions are visible inline with
no chooser, and the link keeps primary emphasis because publishing a link is this surface's
purpose.

### D7. Labels: `displayNames.js`

Add a new `SHARE_ACTIONS` export, declared above `RESULT_PUBLISH` so the two can share strings:

```js
// T11510 (Social Cover Image epic): mobile share vocabulary. A label names the
// payload it sends (EPIC decision 1). No em dashes.
export const SHARE_ACTIONS = {
  SHARE: 'Share',                       // the single entry button (player, tile card face)
  SHARE_MENU_ITEM: 'Share...',          // mobile kebab row that opens the chooser
  SHEET_TITLE: (name) => `Share "${name}"`,
  SHARE_LINK: 'Share link',
  SHARE_LINK_HINT: 'For texts and DMs. Most chat apps show your cover image.',
  COPY_LINK: 'Copy link',
  SHARE_VIDEO: 'Share video',
  SHARE_VIDEO_HINT: 'For posting to Instagram Reels, TikTok or Stories.',
  SHARE_VIDEO_PREPARING: 'Preparing video...',
  MAKING_LINK: 'Making link...',
  CANCEL: 'Cancel',
  DONE: 'Done',
};
```

Changes to `RESULT_PUBLISH`:
- `SHARE_LINK: SHARE_ACTIONS.SHARE_LINK` (drops the ellipsis on 'Share link...'; it is now the
  real link share).
- `SHARE_VIDEO: SHARE_ACTIONS.SHARE_VIDEO`.
- `SHARE_CHOICE_HINT: 'Share link for texts and DMs. Share video to post on Instagram or TikTok.'`
- `COPY_LINK` stays.

Hardcoded "Share" and "Copy Link" strings in `ReelTile.jsx` / `PublishedReelsPanel.jsx` that
this task touches move to these keys.

Analytics: `track('share_initiated', { method, source })`. `method` becomes
`'video' | 'link' | 'clipboard'` (T11530 adds `'cover_image'`), and `source` stays unchanged.

### D8. Other ambiguities resolved or flagged

- **Draft idle phase stays as it is** ("Publish and get link" only). **User decision
  2026-10-01:** no Share video before publishing. Share video appears only on published
  highlights (the chooser, and the draft result's `ready-capable` / `ready` phases).
- **Desktop Copy link** (toast and the highlights list's `copyReelLink`) mints a public link with no review.
  **User decision 2026-10-01:** that is fine; no confirm step, no follow-up task.
- **Collections** (`CollectionCard` share) are out of scope. They have no single cover.
- **Vocabulary (user, 2026-10-01):** the finished product is a **highlight**: a **highlight
  clip** (one play) or a **highlight reel** (a collection of highlight clips). User-facing copy
  never calls a single finished highlight a "reel". `SHEET_TITLE` and the share `title`/`text`
  fallbacks use the highlight's name, falling back to "Highlight" / "this highlight" (today
  `DraftReelPreview.jsx:241-243` falls back to "Highlight Reel"). Code identifiers
  (`ReelTile`, `PublishedReelsPanel`, `final_videos`) keep their names; renaming them is out of
  scope.
- The style guide gains an "Action sheet" entry once this ships and is approved (not before).

## Acceptance Criteria
- [ ] On a coarse-pointer device with file sharing, "Share video" calls `navigator.share` with
      `files` and no `url`, and "Share link" calls it with `url` and no `files`. Unit tests assert
      the exact payload for each.
- [ ] A LINK_ONLY device shows "Share link" and doesn't show "Share video" on every surface: the
      chooser and the draft link-ready grid (which collapses to one full-width button).
- [ ] An unpublished highlight never offers Share video or mints a link without the existing
      "Publish and get link" review (test). A published highlight with no link mints it directly
      on Share link / Copy link, with no review (T10180 R5).
- [ ] No label on any surface names a payload different from the one it sends.
- [ ] Live-verified on a real phone: Share link -> iMessage shows the chosen cover frame in the
      preview card.
- [ ] Desktop ShareModal / Copy link behaviour unchanged.
- [ ] The published highlight player Share, the tile card-face Share and the mobile kebab "Share..." all open the
      same `ShareActionSheet` on coarse pointers (test).
- [ ] `ActionSheet` closes only via Cancel/Done or Escape; tapping the backdrop does nothing
      (test). ReelTile's mobile kebab no longer closes on a backdrop tap and has a Cancel row.
- [ ] The post-export toast on coarse pointers offers no share action (test); desktop toast is
      unchanged.
- [ ] The draft link-ready phase on mobile shows the link card, Share link (cyan) and Share video
      side by side, with no horizontal overflow at 360px.
- [ ] Every new or touched mobile control meets the 44px floor (`coarse-pointer:min-h-11` or
      `min-h-11`): the player Share, LinkReadyCard Copy, the toast action, and the PublishLinkFlow
      buttons.
- [ ] The toast container does not overflow at 360px.
- [ ] A Share video in progress shows "Preparing video..." with a spinner and disables the other
      rows; the sheet closes on success or AbortError and stays open on any other error.
- [ ] No user-facing string added or touched by this task calls a single finished highlight a
      "reel".
