# T11580: Published tab buries the highlight a user just published

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-10-01
**Reported:** User-flagged directly ("their actual artifact was buried in UI instead of at the
forefront and obvious"), mockup/spec built and shared before filing:
https://claude.ai/artifact/WBdHeo6vb3DLCtxSbFbCwT

## Problem

After publishing, a user lands on (or later opens) the Published tab and cannot see what they just
made without digging for it. The Published tab (`CollectionsTab.jsx`) renders the "Top Plays" smart
collection first, then every game group **collapsed by default** (`defaultExpanded={false}` in
`CollectionsTab.renderGameGroup`). The highlight the user just published sits inside whichever game
group it belongs to, requiring: find the right game row, tap its chevron to expand, then scan the
carousel for the new tile. Top Plays — a collection the user did not just create — occupies the most
visible slot instead.

User's own words: "Place published highlight above the 'top plays' and 'game highlights'. The
published highlight should already be expanded instead of requiring the user to hit the arrow to
expand it."

## Solution

Add a "Just published" spotlight card to the top of the Published tab, above Top Plays and every
game group, shown only right after a publish (memory-only, not persisted — see Decision 1 below).
The card is already expanded: full poster, play button, title, game + date, and a Share / Copy link
/ Download action row, with **Share as the primary action** (matches the tab's existing partial-guide
copy, "Use Share or Copy Link on any card"). Tapping the poster opens the existing shared
`CollectionPlayer` on that one highlight. The highlight's own game group (or Mixes, for a
multi-game highlight) auto-expands once on arrival, with its tile ringed and marked NEW; every other
group stays collapsed as today.

Full mockup, phone/desktop before-after, and the two layout options considered live in the spec
artifact linked above.

### Decisions already made (do not re-litigate without a new user ask)

1. **Trigger scope — Option A (recommended, chosen):** the card appears only immediately after a
   publish, not as a permanent "latest highlight" derived from `published_at`. It is memory-only view
   state: cleared on dismiss (X), replaced by a newer publish, or cleared on profile switch/reload.
   Nothing here writes to the backend — persistence rule applies (no new DB field, no reactive save).
2. **Primary action — Share** (not Play). The video itself is already visible and playable in the
   card; Share is the action a user who just finished something actually wants.
3. **Label — "Just published"** pill in the card header.

## Context

### Relevant Files (expected)

- `src/frontend/src/stores/galleryStore.js` — add memory-only `justPublished:
  {finalVideoId, gameId, aspectRatio} | null`, `setJustPublished`, `clearJustPublished`; clear on
  profile switch (existing profile-switch reset path).
- `src/frontend/src/hooks/usePublishProject.js` — on the 200 response, call `setJustPublished` with
  `final_video_id` and the project's single game id (same shape already threaded through
  `finishedReelNav.js`'s `gameId` gating: null for 0 or >1 source games). Set inside the existing
  gesture chain, never in a `useEffect`.
- `src/frontend/src/components/collections/JustPublishedCard.jsx` (new) — reads `justPublished` from
  `galleryStore`, resolves the highlight via the already-cached/lazy member fetch for its game (or
  mixes), renders the large card. Share / Copy link / Download reuse the same handlers
  `CollectionCard`/`CollectionHeader` already call (`onShareCollection`/`onCopyCollectionLink`/
  `onDownloadCollection` passed down from `PublishedReelsPanel`), applied to this one download/project
  rather than a whole collection.
- `src/frontend/src/components/collections/CollectionsTab.jsx` — render `JustPublishedCard` above the
  `smart` collections map. Pass a consume-once flag so the matching game group's `defaultExpanded`
  is true on the first render after publish only (see Landmine below), never on every reopen.
- `src/frontend/src/components/collections/GameCollectionGroup.jsx` — accept an optional
  `highlightId` so `renderCard`'s tile can be ringed/marked NEW when it matches.

### Related Tasks

- None blocking. Independent of the in-flight Social Cover Image epic and T11570 (different screens).

### Technical Notes

**Landmine (do not reintroduce T8990's regression):** `CollectionsTab`'s game groups deliberately
stopped forcing `defaultExpanded` on reopen — the panel unmounts on close, so a forced expand kept
re-opening the same group and silently discarded whatever the user had actually expanded/collapsed.
The auto-expand added here must be a **consume-once** signal (fires once right after the triggering
publish, then the flag is cleared — e.g. read-and-clear a nonce/ref, not a prop derived from
`justPublished` itself staying truthy), so later reopens of the Published tab do not keep re-forcing
that same group open.

**Aspect ratio layout:** 9:16 renders as a stacked card (video capped ~300px tall on phone). 16:9
renders full-width on phone and two-column (video left, title/actions right) at `sm` and up — a
stacked 16:9 card pushes everything below off the first screen on desktop. See the artifact's
desktop mockup section.

**Duplicate tile is intentional:** the highlight appears twice (spotlight card + its tile in the
expanded game group). The ring/NEW badge on the tile is what ties the two together so the user learns
where it lives after dismissing the card. Dismissing the card never removes the tile.

**Missing highlight:** if the highlight referenced by `justPublished` is no longer in the profile's
published set (deleted, unpublished, moved to another profile) by the time the card would render,
render nothing — no placeholder, no error toast.

## Implementation

### Steps

1. [ ] Add `justPublished` state + setter/clearer to `galleryStore.js`; wire profile-switch reset.
2. [ ] Set `justPublished` from `usePublishProject.publish()`'s success path (both publish entry
   points — `DraftTile`'s Publish button and `DraftReelPreview`'s "Publish and create link" — already
   funnel through this one hook, so one call site covers both).
3. [ ] Build `JustPublishedCard.jsx`: resolves the highlight, renders poster/play/title/date/actions,
   dismiss (X) clears `justPublished`.
4. [ ] Wire the card into `CollectionsTab.jsx` above Top Plays; thread the consume-once auto-expand
   signal into the matching `GameCollectionGroup` (or the Mixes group).
5. [ ] Add the ring/NEW badge affordance to the matching tile via `highlightId` in
   `GameCollectionGroup.jsx`.
6. [ ] Verify both aspect-ratio layouts at phone (390px) and desktop widths; no horizontal scroll.

### Progress Log

**2026-10-01:** Filed from user report + approved mockup/spec. Not yet started.

## Acceptance Criteria

- [ ] Publishing via `DraftTile`'s Publish button lands on the Published tab with the new highlight
      as the first card, already expanded/playable, above Top Plays — no tap required to see it.
- [ ] Publishing via the draft preview's "Publish and create link", then closing the player and
      opening the Published tab, shows the same card.
- [ ] The highlight's game group (or Mixes) is expanded on that arrival; its tile is ringed and
      marked NEW; every other group stays collapsed.
- [ ] Closing and reopening the Published tab afterward keeps the card visible but does **not**
      re-force the group open if the user had collapsed it (regression guard for the T8990 landmine
      above).
- [ ] Tapping X dismisses the card; a subsequent publish, a reload, or a profile switch clears or
      replaces it.
- [ ] Share, Copy link, and Download on the card produce the same result as the equivalent actions on
      the highlight's own tile.
- [ ] Layout holds with no horizontal scroll at 390px and 1280px, for both 9:16 and 16:9 highlights.
