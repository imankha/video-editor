# T6700: Owner in-app playback doesn't show the intro card

**Status:** TODO
**Impact:** 6 | **Complexity:** 6
**Epic:** [Player Intro + Rich Text](EPIC.md)
**Follows:** [T5220](T5220-add-intro-integration.md) — apply the intro at every egress

## Problem

Found live-testing T5220 (2026-08-08): the owner's own in-app "Play" button — for both a single
reel and a collection, both routed through `DownloadsPanel.jsx` — never shows the attached intro
card. T5220's design deliberately scoped "every egress" to 4 paths: owner download, single-reel
share playback, single-reel share download, collection-share playback. Playing your own content
directly inside the app (not downloading, not opening a share link) was never in that list, so
this is a real product gap, not a regression in T5220 — confirmed by reading `.claude/knowledge/
export-pipeline.md`'s T5220 section, which enumerates exactly those 4 wiring points and nothing
else.

Root cause (traced this session, don't re-derive): `DownloadsPanel.jsx` funnels BOTH single-reel
play (`handlePlay`, ~line 385) and collection play (`onPlayCollection`, ~line 90) into the same
`storyPlayer` state, which renders `CollectionPlayer.jsx` directly (`DownloadsPanel.jsx:706-722`).
`CollectionPlayer.jsx` has zero `intro`/`IntroPreRoll` awareness — it goes straight to
`<video autoPlay>` (`CollectionPlayer.jsx:343-352`). `DownloadsPanel.jsx` already has plenty of
intro *assignment* UI (`introCards`, `setIntroCard`, `IntroCardPicker`) but never fetches or
renders the intro payload for playback.

## Solution (needs an Architecture design pass, not a direct implementation)

The share path's own design notes flag the exact landmine this task will hit: `CollectionPlayer.
jsx`'s `<video autoPlay>` "has no pause hook," which is why `SharedVideoOverlay.jsx`/
`SharedCollectionView.jsx` handle the share-path intro pre-roll via an unmount/mount SWAP
(`IntroPreRoll` replaces `CollectionPlayer` entirely until `onDone`) rather than a prop.
`CollectionPlayer.jsx` is shared playback infrastructure reused elsewhere, so the same swap
approach needs to be verified safe here — plus a data-fetching decision (does `DownloadsPanel`
need a new endpoint/payload shape to get `{card, previewUrl, field_values, profile}` for a reel
it already has full data for locally, since it's the owner's own reel, not a cross-account share
resolution?). **Do not hand this to an implementor directly — resolve the fetch/mount design
first**, matching the process T6680 is already flagged for (design gate before implementation).

Also worth deciding explicitly: should the SAME auto-continue bug T6700's sibling investigation
found in the share path (see T5220's post-merge fix, if landed by the time this starts) be
designed out from the start here, rather than reintroduced independently.

## Context

### Relevant Files
- `src/frontend/src/components/DownloadsPanel.jsx` — `handlePlay` (~385), `onPlayCollection`
  (~90), `storyPlayer` render (~706-722); has intro-assignment UI already, no playback wiring
- `src/frontend/src/components/collections/CollectionPlayer.jsx` — the shared player, `<video
  autoPlay>` at ~343-352, no intro/pause-hook awareness today
- `src/frontend/src/components/introcards/IntroPreRoll.jsx` — the existing pre-roll component
  (wraps `MotionPreview`), already proven on the share path — reuse, don't rebuild
- `src/frontend/src/components/SharedVideoOverlay.jsx`, `src/frontend/src/components/
  SharedCollectionView.jsx` — reference implementations of the unmount/mount swap pattern
- `app/services/intro_egress.py` (`resolve_intro_for_reel`, `mode="playback"`) — backend
  resolution helper T5220 built; likely reusable, but `DownloadsPanel` already has the reel/
  collection data client-side, so check whether a new endpoint is even needed vs. reusing `GET
  /api/downloads`'s existing `resolved_intro_*` fields

### Related Tasks
- [T5220](T5220-add-intro-integration.md) — the 4 egress paths this task extends to a 5th
  (owner in-app playback); read its design doc (`docs/plans/tasks/T5220-design.md`) for the
  shared serializer/component precedent before designing this
- [T6680](T6680-default-athlete-intro-card-provisioning.md) — also design-gated, unrelated
  scope, just the sibling precedent for "don't implement without a design pass"

## Classification hint
L-tier: touches shared playback infrastructure (`CollectionPlayer.jsx`) used by both the owner
path and (indirectly, as the thing `SharedCollectionView` swaps out) the share path — needs the
Architecture design gate before implementation, not a direct M-tier fix.

## Acceptance Criteria
- [ ] Playing a single reel directly (owner, in-app, not via download/share) shows its resolved
      intro card as a pre-roll, mirroring the share-playback behavior.
- [ ] Playing a collection directly (owner, in-app) shows its resolved intro card as a pre-roll.
- [ ] Playback continues automatically from intro into the underlying video with no manual
      resume step required (do not reintroduce the autoplay-attribute-toggle bug found on the
      share path in this same session).
- [ ] `CollectionPlayer.jsx`'s existing callers (including the share-path swap it's used inside
      of) are unaffected.
