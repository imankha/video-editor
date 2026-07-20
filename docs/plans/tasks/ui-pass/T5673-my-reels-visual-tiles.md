# T5673: My Reels drawer — visual tiles

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-20
**Epic:** [UI Pass](EPIC.md) — task 3 of 7

## Problem

Audit finding #3: the My Reels drawer is the *celebration* surface — finished, published reels
of a kid's best moments — and it renders as gray text rows (icon + name + "6 reels · 1m 21s"),
plus collapsed text-only game groups. This is the single surface where imagery matters most,
and it has none. Meanwhile **published reels already have poster images** — T5280
(clearest-frame-posters epic) captures a poster at publish time — so unlike the drafts tab,
the image source largely exists already.

## Solution

Re-skin the drawer contents with the tile language from T5672:

- **Collections rows (Top Plays / Top Dribbles / Top Passes)** and **per-game groups**: replace
  text rows with small poster thumbnails (landscape-of-portrait strip or single leading
  poster + count) — exact form per UI Designer pass; reuse `CardCarousel` where a group
  expands to multiple reels.
- Expanded game groups list reels as poster tiles (reuse `DraftTile` styling minus
  draft-progress chrome — published reels have no Framing/Overlay strip).
- Keep: Ranking Progress card, Select mode, play/share/kebab actions — this task changes the
  *look* of rows, not drawer behavior.
- Poster source: published-reel poster from T5280 (locate the field/endpoint on the published
  reel model; it exists — the og:image path uses it). For any entry without a poster, the same
  branded fallback tile as T5672. Only if a *class* of drawer entries turns out to have no
  poster does T5671's endpoint get reused.

## Context

### Relevant Files (REQUIRED)
- The My Reels drawer component tree (opened by the header "My Reels" button over `/home`;
  locate via grep "My Reels" / "Ranking Progress" in `src/frontend/src` — not part of the
  2026-07-20 code audit's map)
- `src/frontend/src/components/shared/CardCarousel.jsx` + `DraftTile.jsx` — from T5672 (reuse, don't fork)
- Published-reel poster source: T5280's publish-poster storage (see
  [clearest-frame-posters EPIC](../clearest-frame-posters/EPIC.md); og:image share path reads it)

### Related Tasks
- Depends on: T5672 (tile + carousel components), T5671 only as fallback for poster-less entries
- Sibling: T5280 (poster at publish) — the data this task consumes

### Technical Notes
- Drawer stays a drawer; no navigation/route changes (that's T5677's territory).
- No backdrop-close changes (standing rule: modals never close on backdrop click).
- Lazy-load posters; the drawer opens over the home screen and must not jank it.
- Ranking gauge card ("Warming up") is fine as-is; leave it.

## Implementation

### Steps
1. [ ] Locate drawer components + published-reel poster field; confirm poster coverage on real data
2. [ ] UI Designer: drawer tile spec (approval)
3. [ ] Re-skin collection rows + game groups with poster tiles
4. [ ] Fallback tile for poster-less entries
5. [ ] Unit + E2E (drawer opens, tiles render, play/share/select still work) at both widths

## Acceptance Criteria

- [ ] Collections and game groups in My Reels show poster imagery
- [ ] All existing drawer actions (play, copy link, kebab menu, Select mode) unchanged and working
- [ ] Poster-less entries show the branded fallback, never a broken image
- [ ] Mobile 390px: drawer usable, tiles ≥44px touch targets, no horizontal overflow
- [ ] Real-browser screenshots at 390px and 1280px+; frontend tests pass
