# T8540: Share is the primary player action

**Status:** STAGING
**Impact:** 7
**Complexity:** 2
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source)

## Problem

The reel player dialog offers Re-edit, Re-rank, Download, Close - no Share. Share and
Copy Link exist only inside the reel card's kebab "More actions" menu, listed below
Download (walkthrough screenshots 16/17). The landing page's headline promise is
"share via a single link"; prod cliff 4 shows zero real users have ever completed a
share of a self-made reel. Even a user who survives every upstream friction must
discover an overflow menu to finish the product's job.

## Surfaces involved (verified in source)

- **Player dialog** = `src/frontend/src/components/collections/CollectionPlayer.jsx`.
  Toolbar has "Re-rank this reel" (title at line 342, gated per T4030 - single-clip
  reels only, see CollectionPlayer.test.jsx line 152-156), Re-edit, Download, Close.
  No Share.
- **Card + kebab** = `src/frontend/src/components/collections/ReelTile.jsx`. Header
  comment at line 51: '"main button + kebab for the rest" - BOTH Share and Copy Link
  now live in [the kebab]'. Two kebab variants exist (coarse-pointer sheet and
  fine-pointer popover - see ReelTile.test.jsx lines 80-111): Copy Link at lines
  ~394/~456, Open as Draft at ~417/~477. T7350's pointer-capability lesson applies
  (share UA-sniff landmine memory: capability, not UA).
- Share/Copy Link handlers inside ReelTile call the existing share flow - trace the
  onClick targets (share modal component + link-creation endpoint) and REUSE them
  verbatim; do not invent a new share path. `useWebShare` hook
  (`src/frontend/src/hooks/useWebShare.js`) already wraps navigator.share vs
  clipboard (GlobalExportIndicator uses it at line 105: mobile 'Share' / desktop
  'Copy Link').

## What to build

### Step 1 - Share becomes the player's primary action

In `CollectionPlayer.jsx`'s toolbar:
- Add a primary-variant Share button (label: "Share", icon per ui-style-guide; on
  coarse pointers it invokes the same handler the kebab's Share uses - Web Share
  sheet; on fine pointers Copy Link semantics with a "Link copied" toast, mirroring
  useWebShare's existing split).
- Order + weight: Share (primary, visually dominant) then Download (secondary).
  Re-edit and Re-rank demote to icon-only/tertiary at the toolbar's end; their
  existing gating (T4030 re-rank singles-only) unchanged.
- The player needs the reel's share payload (same props/data ReelTile's kebab handler
  uses) - thread it through the player's existing props; the player already knows the
  active reel (`activeReel` per CollectionPlayer.jsx line 35 comment).

### Step 2 - card face affordance

In `ReelTile.jsx`: promote Share out of the kebab onto the card face as the visible
secondary action next to Play (small labeled button, not icon-only - this is the
product's verb). Keep Share ALSO in the kebab (both pointer variants) so nothing
breaks for muscle memory; Copy Link, Intro, Open as Draft, Delete stay kebab-only.
Respect the existing coarse/fine pointer split exactly as the current code does.

### Step 3 - tests

- `CollectionPlayer.test.jsx`: Share renders for every reel (not gated like Re-rank);
  fires the share handler; Download still present. Re-rank gating tests untouched.
- `ReelTile.test.jsx`: card-face Share visible in both pointer modes; kebab still
  lists Share + Copy Link (existing tests at lines 80-111 keep passing, extend for
  the card-face button).
- e2e: open player -> tap Share -> (desktop) clipboard contains the share URL /
  toast "Link copied". Mobile viewport 390x844: Share is the first button, fully
  in-viewport (T8550 assertion).

## Explicitly NOT in scope

- New share backend, link formats, or share-page changes (T8410/T8420 own share
  pages).
- Changing what Download does.
- The Highlight Reels drawer layout (T8470) or the publish flow (T8530).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/CollectionPlayer.jsx` (toolbar; line 35, 342)
- `src/frontend/src/components/collections/ReelTile.jsx` (51, 387-477)
- `src/frontend/src/hooks/useWebShare.js` - the share/copy split to reuse
- Tests: CollectionPlayer.test.jsx, ReelTile.test.jsx
- ui-style-guide skill - button hierarchy

### Related Tasks
- T8530's post-publish success lands users here; T8400 later makes this the publish
  landing - the Share button must already be primary by then
- Memory: share UA-sniff landmine (T7350) - pointer capability, never UA sniffing

## Acceptance Criteria

- [ ] Share reachable in one tap from the open player, no overflow menu
- [ ] Share visually primary relative to Download; Re-edit/Re-rank demoted
- [ ] Card face shows Share in both pointer modes; kebab retains it
- [ ] All existing gating (T4030 re-rank) and pointer-split behavior unchanged
- [ ] Unit + e2e green; 390x844 verified
