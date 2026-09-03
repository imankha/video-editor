# T8410: Teammate-tag share page: add the "make your own reel" CTA

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-09-03

## Problem

When a teammate's parent clicks a tag-notification link, they land on
`SharedAnnotationView.jsx` — the page a same-team parent hits when their kid gets tagged in
someone else's clip. This is the closest thing the product has to CapCut's "someone sent me
a template" viral moment, and the audience is exactly who the growth thesis names (another
parent on the same team). Today, signed-out visitors see nothing but a sign-in gate:

- Header wordmark (`SharedAnnotationView.jsx:73`): `REEL BALLERS`, plain text, no CTA.
- Sign-in gate (`SharedAnnotationView.jsx:196-200`): a single `Sign in to watch` button.
- No mention anywhere on the page that this same product can make a reel for THEIR kid.

Meanwhile the reel and collection share pages already solve this exact problem with a
working, tracked CTA (`BrandedEndCard`) — it's just never been wired into this page.

## Solution

Reuse `BrandedEndCard` (`src/frontend/src/components/BrandedEndCard.jsx`) on
`SharedAnnotationView.jsx`'s signed-out view. See `SharedCollectionView.jsx:138-140` for the
existing wiring pattern (`visible`/`onReplay` props). This page doesn't have a video-end
event to key off (the signed-out state never plays anything — it's a pure gate), so the
end-card should render as a persistent element alongside/below the sign-in gate rather than
waiting for a video-end trigger. Reuse the component's existing copy
("Make your own reel at www.reelballers.com") and UTM params
(`utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard`) verbatim — do not
invent new copy or a new tracking campaign for this placement; if the CTA needs a distinct
campaign tag to separate this surface's conversion from the reel share page's, that's a
one-line UTM parameter change, not a design question, but call it out if you make it so the
attribution report doesn't silently assume both spots. This is a copy consistency task, not
a re-design.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/SharedAnnotationView.jsx` — the page being changed (lines
  70-217 cover the header, sign-in gate, and the `SignedOutShell` wrapper)
- `src/frontend/src/components/BrandedEndCard.jsx` — the CTA component being reused, do not
  fork it
- `src/frontend/src/components/SharedCollectionView.jsx:136-140` — reference wiring pattern
- `src/frontend/src/components/SharePageInstallBanner.jsx` — already renders below the
  sign-in gate on this page (per T7690's audit); make sure the new CTA and this banner don't
  visually compete or duplicate messaging — check its current copy before placing the
  end-card near it

### Related Tasks
- See [EPIC.md](EPIC.md) for the full decision record and shared context.
- Sibling task T8420 does the same reuse on a different file (`SharedGameView.jsx`) — no
  file overlap, can run in parallel.

### Technical Notes
- No backend or API changes. This is a frontend-only component wiring change.
- `SharedAnnotationView.jsx`'s signed-out state has both a game-context header
  (`data.sharer_name`, `title`) and the sign-in gate — verify the new CTA doesn't get
  visually lost between them at both desktop and 375px (this page uses a `fixed inset-0`
  full-screen layout, not a scrollable page, so vertical space is at a premium).

## Implementation

### Steps
1. [ ] Read `BrandedEndCard.jsx`'s props/API and `SharedCollectionView.jsx`'s usage
2. [ ] Add `BrandedEndCard` (or an equivalent persistent-render mode of it) to
   `SharedAnnotationView.jsx`'s signed-out view
3. [ ] Verify no visual collision with `SharePageInstallBanner`
4. [ ] Real-browser check at desktop and 375px (signed-out state only — this page has no
   signed-in visual change)

## Acceptance Criteria

- [ ] A signed-out visitor to a teammate-tag share link sees the "Make your own reel"
      CTA, using the existing component/copy/UTM tracking verbatim (or a documented,
      deliberate UTM variant)
- [ ] The sign-in gate itself is unchanged in function (still gates playback)
- [ ] No visual collision with `SharePageInstallBanner`
- [ ] Verified in a real browser at desktop and 375px
