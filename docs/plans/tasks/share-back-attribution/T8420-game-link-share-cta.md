# T8420: Game-link share page: add the same CTA alongside the claim button

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-03

## Problem

`SharedGameView.jsx` is the page a team parent lands on from a full game-recap share link.
Its only CTA today (`SharedGameView.jsx:117`) is `Add this game to your account`, which
routes to `/claim/game/{token}` — a much bigger commitment than "try making a reel." A
visitor who isn't ready to import an entire game (with its team plays, per the comment at
`SharedGameView.jsx:16-17`) has no lighter next step, even though this product's actual
viral loop — make a reel from footage you already have — doesn't require claiming anything.

The header (`SharedGameView.jsx:73`) also shows the same unlinked `REEL BALLERS` wordmark as
the teammate-tag page (see sibling task T8430 for that fix — don't duplicate it here).

## Solution

Add the same `BrandedEndCard` CTA used on the reel/collection share pages
(`src/frontend/src/components/BrandedEndCard.jsx`) to `SharedGameView.jsx`, alongside — not
replacing — the existing `Add this game to your account` button. Reuse the component's
existing copy and UTM tracking verbatim per the same rule as T8410. This page does have a
video (the game recap), so prefer keying the end-card off the video's `ended` event if one
exists on this page already, matching the pattern used on the reel/collection pages; if this
page has no such playback-end hook today, render it as a persistent secondary CTA near the
claim button instead (same fallback as T8410) rather than adding new playback-tracking
machinery just for this.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/SharedGameView.jsx` — the page being changed; CTA button at
  line 117, "Filmed by" attribution line at line 77, claim-flow comment at lines 16-17
- `src/frontend/src/components/BrandedEndCard.jsx` — the CTA component being reused
- `src/frontend/src/components/SharedCollectionView.jsx:136-140` — reference wiring pattern
  if this page has a video-end hook to key off

### Related Tasks
- See [EPIC.md](EPIC.md) for the full decision record and shared context.
- T8430 fixes the wordmark link on this same file — sequence after or coordinate to avoid a
  merge conflict on `SharedGameView.jsx`'s header block; T8430 is a 1-line change so landing
  it first is simplest.
- T8410 does the equivalent reuse on `SharedAnnotationView.jsx` — no file overlap.

### Technical Notes
- No backend or API changes.
- Keep the existing `Add this game to your account` CTA as the primary action (it's the
  actual claim mechanism); the new CTA is secondary/lighter, not a replacement.

## Implementation

### Steps
1. [ ] Check whether `SharedGameView.jsx` already has a video-end hook; if yes, key the
   end-card off it (matches reel/collection pattern); if no, render persistently
2. [ ] Add `BrandedEndCard` alongside the existing claim CTA, same copy/UTM as T8410
3. [ ] Real-browser check at desktop and 375px — verify both CTAs are legible and don't
   compete for the primary-action slot

## Acceptance Criteria

- [ ] A visitor to a game-link share page sees both the claim CTA and the "Make your own
      reel" CTA, using the existing component/copy/UTM tracking verbatim
- [ ] The claim flow itself is unchanged in function
- [ ] Verified in a real browser at desktop and 375px
