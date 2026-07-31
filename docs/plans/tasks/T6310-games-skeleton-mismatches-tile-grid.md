# T6310: Startup skeleton is the OLD games list — loaded UI is a poster-tile grid

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-31
**Updated:** 2026-07-31

## Problem

User report (2026-07-31, imankh): *"when I startup I get this screen which was a relevant
preloading screen for our previous UI but not our new UI."*

`GamesListSkeleton` (`ProjectManager.jsx:1330`, added by T4771) still draws the pre-T5673 list
layout. The games list was since re-skinned to a landscape poster-tile grid, and the skeleton was
never updated. So the first thing a user sees on startup is a stack of narrow horizontal rows
that then snaps into a wide 6-up grid of 16:9 tiles.

Concretely, the two do not agree on **either** axis:

| | Skeleton (`:1330-1350`) | Loaded games list |
|---|---|---|
| container | `w-full max-w-2xl` | `w-full max-w-6xl 2xl:max-w-7xl` (`:777`) |
| layout | `space-y-2` vertical stack | `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 lg:gap-4` (`:846`) |
| item | `p-3 sm:p-4` row: 18px icon + title bar + 3 meta bars | `GameTile` — `aspect-video` poster card (`GameTile.jsx:189`) |

Its own docstring still claims it *"mirrors the loaded layout"* — that comment was true when
written and is now false. So the skeleton is doing the opposite of its stated job: it guarantees
a layout jump rather than preventing one.

**This is much more visible than it looks.** Per **T6240**, cold boot currently serializes for
~22 seconds — so this wrong skeleton is the app's face for most of a very long startup, and it
is the *first* impression on every cold load.

## Solution

Rebuild `GamesListSkeleton` to mirror the tile grid it now precedes: same container width, same
grid columns and gaps, and `aspect-video` shells instead of list rows.

Prefer deriving the shared shape over duplicating the class strings — if the grid classes are
literal in both places they will drift again the next time the grid changes. A shared constant
for the grid/container classes (used by both the real list and the skeleton) is enough; do not
build an abstraction beyond that.

Check the sibling skeletons in the same pass — Reel Drafts and My Reels also have loading states
(`DraftTile.jsx`, `ReelTile.jsx`, `DownloadsPanel.jsx`, `CollectionPlayer.jsx`). T5672 polished
some of them; confirm which, and fix any with the same drift rather than leaving a half-consistent
set. Report which were already correct.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — `GamesListSkeleton` `:1330-1355` (the stale
  one), its render site `:749-750`, the loaded container `:777`, the tile grid `:846`
- `src/frontend/src/components/GameTile.jsx` — `aspect-video` tile root `:189`; the shape the
  skeleton must match
- `src/frontend/src/components/DraftTile.jsx`, `components/collections/ReelTile.jsx`,
  `components/DownloadsPanel.jsx`, `components/collections/CollectionPlayer.jsx` — sibling
  loading states to audit
- `.claude/references/ui-style-guide.md` — skeleton/loading conventions

### Related Tasks
- **T4771** — added `GamesListSkeleton` against the then-current list layout. Not a mistake at
  the time; it simply was not updated when the grid landed.
- **T5673 / T5672** (UI Pass epic) — re-skinned tiles to poster cards and polished
  GameTile/ReelTile states. This is the loose end from that epic.
- **T6240** — the ~22s cold boot that makes this skeleton so prominent. Independent fix, but it
  is *why* this is worth more than its size suggests.

### Technical Notes
- Keep it a pure render component with no data dependency — it must not fetch or subscribe.
- Match the real grid's responsive breakpoints exactly (2 / 3 / 6 columns); a skeleton that is
  right on desktop and wrong on mobile just moves the jump.
- `count = 4` is the current default; the grid is 6-up on desktop, so pick a count that fills the
  first row sensibly at each breakpoint rather than leaving a ragged partial row.
- The `animate-pulse` treatment and gray palette already match the style guide — keep them.

## Implementation

### Steps
1. [ ] Rebuild `GamesListSkeleton` to the tile-grid shape (container + grid + `aspect-video` shells)
2. [ ] Share the container/grid class strings between the real list and the skeleton
3. [ ] Fix the stale "mirrors the loaded layout" docstring
4. [ ] Audit the sibling skeletons; fix any with the same drift, report those already correct
5. [ ] Verify no layout shift at 375px, tablet, and desktop widths

## Acceptance Criteria

- [ ] The startup skeleton visually matches the loaded games grid — no snap when data arrives
- [ ] Verified at mobile (375px), tablet, and desktop breakpoints
- [ ] Sibling skeletons audited, with a stated disposition for each
- [ ] Skeleton remains a pure render component (no fetching/subscribing)
- [ ] Frontend unit tests pass
