# T17850: Carousel edge cards hide their play button under the arrows

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-19
**Updated:** 2026-11-19

## In plain words

On Home, a game's highlights sit in a sideways carousel (for example under "Game highlights (portrait)"). Cards at the left and right edges are cut off and faded, but their round play button still shows, and it sits right under the carousel's previous/next arrow. The owner, testing staging on 2026-11-19, found the right edge card's play button overlapping the next arrow, so the two controls look like one and a tap can hit the wrong one. The left edge card's play button sits next to the previous arrow the same way.

## Ruling

Owner, 2026-11-19: for the items at the edges of the carousel, don't show the play buttons.

## Repro

1. On staging, open Home with a game that has more highlights than fit across the screen (the owner's had 10 in "Game highlights (portrait)").
2. Look at the cut-off cards at the left and right ends of the carousel.
3. Their play buttons show under or against the previous/next arrows.

## Solution

- A card that is only partly visible at either end of the carousel shows no play button. Once scrolled fully into view it shows its play button as usual.
- Apply the same to the card's other overlay controls (Share, the pencil) wherever they would sit under an arrow; the owner's words name the play button, so it is the minimum.
- Fix it once in the shared carousel (`src/frontend/src/components/shared/CardCarousel.jsx`, which already knows which cards are clipped, since it fades them) rather than in each card type, so every carousel using edge cards gets it.
- Tapping the faded edge card itself can keep doing what it does today (e.g. scroll it into view); only the overlapping buttons go.

## Relevant Files

- `src/frontend/src/components/shared/CardCarousel.jsx`
- `src/frontend/src/components/collections/GameCollectionGroup.jsx`
- `src/frontend/src/components/PublishedReelsPanel.jsx`

## Acceptance Criteria

- [ ] C1: In a Home highlights carousel with cards cut off at both ends, neither edge card shows a play button, and no card control overlaps the previous or next arrow, at phone and desktop widths.
- [ ] C2: After scrolling so a previously cut-off card is fully visible, its play button appears and still plays that highlight; fully visible cards keep their play and Share buttons as before.
