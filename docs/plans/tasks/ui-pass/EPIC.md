# UI Pass (Home tiles/carousel + polish fixes)

**Status:** TODO
**Created:** 2026-07-20
**Impact:** 6 · **Complexity:** 4 · **Priority:** 1.5

## Goal

A polish pass over the whole app so there is **no poor, ugly, or wrong-for-the-problem UI** —
nothing drastic, no new features. Two thrusts:

1. **Make the home surfaces visual.** This is a *video* product whose home screen is 100% text
   rows. Reel Drafts becomes poster-thumbnail tiles in a Netflix-style horizontal carousel under
   each game; My Reels gets the same treatment. Blocked on one enabling fact: **no thumbnail
   image exists anywhere in the draft/clip data model today** (verified by code audit
   2026-07-20), so a backend poster task comes first.
2. **Fix the audit findings** — element collisions, overflow, dead space, cryptic labels, and
   navigation dead-ends found by driving the real app.

**Every task in this epic ships mobile (360–428px) AND desktop (≥1280px), verified in a real
browser at both widths before it's called done.** jsdom-only proof is not acceptance (T5380
lesson). Use the `responsiveness` skill + the T4930 usability matrix where applicable.

## Audit provenance (2026-07-20)

Findings come from driving the dev app as `imankh@gmail.com` (Playwright, real data) at
1315×748 desktop and 390×844 mobile, across Home (Games + Reel Drafts tabs), My Reels drawer,
Annotate, Framing, and Overlay. Code map from a parallel audit of `ProjectManager.jsx` et al.

### Findings ledger (→ owning task)

| # | Finding | Task |
|---|---------|------|
| 1 | Reel Drafts are full-width text rows; no imagery anywhere on home; poor fit for a video product | T5672 |
| 2 | No thumbnail/poster field exists for drafts or clips; only live video streams | T5671 |
| 3 | My Reels drawer (the celebration surface) is text rows too; published reels *already have* posters (T5280) | T5673 |
| 4 | "Report a problem" pill floats mid-content on editor screens; overlaps the player volume control in Annotate | T5674 |
| 5 | Annotate left panel shows a stray horizontal scrollbar | T5674 |
| 6 | Framing crop-size label (`513x911 @ (2, 25)`) clips at the top video edge | T5674 |
| 7 | Overlay letterboxes a 9:16 video in a 16:9 stage — ~2/3 of the preview is black pillarbox | T5676 |
| 8 | Logo lockup wraps to "Reel" / icon / "Ballers" stacked — reads broken on all widths | T5675 |
| 9 | Hero (logo + tagline + continue + tabs + CTA + boxed filters) pushes content below the fold | T5675 |
| 10 | Games-card metadata is cryptic to a soccer parent: `5!! · 5! · Quality: 25`, unlabeled dates | T5675 |
| 11 | "Continue where you left off" is absent on mobile — decide deliberately, don't leave implicit | T5675 |
| 12 | `/home/games` deep-link bounces back to `/home/reels`; unknown routes (e.g. `/gallery`) land on `/framing` | T5677 |
| 13 | Desktop home wastes most of the viewport (single `max-w-2xl` column) — the carousel absorbs this | T5672 |

## Shared design decisions

1. **No thumbnails → no tiles.** T5671 (backend posters) strictly precedes T5672/T5673 UI work.
   Reuse the clearest-frame helpers from the [clearest-frame-posters epic](../clearest-frame-posters/EPIC.md)
   (`src/backend/app/services/poster.py` — `generate_and_store_poster:402`,
   `ensure_recap_poster:529`); deterministic R2 keys, generate-on-demand + warm-at-gesture,
   poster failure never fails the parent operation. No new schema — key derived from IDs.
2. **Carousel is a net-new shared component** (`CardCarousel` or similar): none exists in the
   codebase (verified — no `snap-x`/`carousel` anywhere; closest precedent is
   `overflow-x-auto scrollbar-hide` in `AnnotateFullscreenOverlay.jsx:508`; `scrollbar-hide`
   utility already in `src/frontend/src/index.css:25-31`). CSS scroll-snap + native touch swipe
   on mobile; hover arrow buttons on desktop (`fine-pointer` variant); no JS carousel library.
3. **Scroll/filter/tab state is ephemeral.** No persisted view state (standing rule); carousel
   position, filter chips, expanded groups are never written anywhere.
4. **Touch floors:** all new interactive elements ≥44px on coarse pointers (T5360/T5430
   pattern — `coarse-pointer` Tailwind variant + `Button` primitive floors).
5. **Style guide is updated in the same PR** that introduces a new pattern (tile card, carousel)
   — `.claude/references/ui-style-guide.md` + `src/frontend` ui-style-guide skill. A landed
   pattern that isn't in the guide misleads the next agent.
6. **No behavior changes ride along.** Tasks 4–7 are presentational/navigational polish; data
   flow, persistence, and export paths are untouched. Any bug found deeper than the UI gets its
   own task, not a drive-by fix.
7. **`ProjectManager.jsx` is 2271 lines** holding every card variant. Tile/carousel work
   extracts the components it touches (`ProjectCard`, `SegmentedProgressStrip`, `CardCarousel`)
   into files, but this epic is NOT a general refactor of that file — moves are mechanical
   commits, behavior changes separate (refactoring rules).

## Tasks (in order)

| ID | Task | Status |
|----|------|--------|
| T5671 | [Draft poster thumbnails (backend)](T5671-draft-poster-thumbnails.md) | IN PROGRESS |
| T5672 | [Reel Drafts as tiles in per-game carousels](T5672-drafts-tiles-carousel.md) | IN PROGRESS |
| T5673 | [My Reels drawer: visual tiles](T5673-my-reels-visual-tiles.md) | IN PROGRESS |
| T5674 | [Overlap & overflow fixes (report pill, panel scrollbar, crop label)](T5674-overlap-overflow-fixes.md) | IN PROGRESS |
| T5675 | [Home header/hero + games-card legibility](T5675-home-hero-legibility.md) | IN PROGRESS |
| T5676 | [Aspect-aware video stage (kill the 9:16 pillarbox)](T5676-aspect-aware-video-stage.md) | IN PROGRESS |
| T5677 | [Home tab deep-links + unknown-route fallback](T5677-home-deeplinks-route-fallback.md) | IN PROGRESS |
| T5678 | [Remove batch Select flow from My Reels](T5678-remove-batch-select-my-reels.md) — bundled into the T5673 worker | IN PROGRESS |
| T5679 | [Top Play rank badge on My Reels tiles](T5679-top-play-rank-badge.md) — bundled into the T5673 follow-up worker | TODO |

T5671 → T5672 → T5673 are sequenced (thumbnails unlock tiles). T5674–T5677 are independent of
the tile track and of each other; they may run in parallel workers (file-ownership check: T5675
and T5672 both touch `ProjectManager.jsx` — do NOT run those two concurrently).

## Completion criteria

- [ ] Reel Drafts renders as poster tiles in horizontal per-game carousels, mobile swipe +
      desktop arrows, with status/progress still visible per tile
- [ ] My Reels drawer shows poster tiles for published reels
- [ ] Zero element collisions or stray scrollbars on Annotate/Framing/Overlay at 390px, 768px,
      1280px+ (screenshot evidence)
- [ ] 9:16 preview no longer pillarboxed into a 16:9 stage
- [ ] Logo lockup renders as one intentional unit at all widths
- [ ] Games-card metadata readable by a non-expert (labels/tooltips)
- [ ] `/home/games` and `/home/reels` deep-link correctly; unknown routes land somewhere sane
- [ ] Style guide updated with tile + carousel patterns
- [ ] All touched screens pass the T4930 usability matrix
