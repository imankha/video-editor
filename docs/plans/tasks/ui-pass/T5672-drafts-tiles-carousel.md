# T5672: Reel Drafts as tiles in per-game carousels

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-20
**Epic:** [UI Pass](EPIC.md) — task 2 of 7

## Problem

The Reel Drafts tab is a vertical stack of full-width text rows (`space-y-2` inside a
`max-w-2xl` centered column) — audit findings #1 and #13:

- A **video product's home screen shows zero imagery**. Every draft card is title + tag chips
  + metadata text + a progress strip. Users pick clips by *what they look like*; the UI gives
  them words.
- On desktop the single narrow column **wastes most of the viewport** — at 1280px+ roughly
  two-thirds of the screen is empty background.
- 13 drafts under one game = a wall of ~13 same-looking rows; the per-game grouping
  (`CollapsibleGroup`) helps but scanning is still linear.

User direction: tiles, "Netflix style with a carousel under the game".

## Solution

Replace the grouped vertical list with **per-game horizontal carousels of poster tiles**
(Netflix row idiom): game header (name + status-dot counts, kept from `CollapsibleGroup`) with
a horizontally scrolling row of portrait tiles beneath.

**Tile (portrait, 9:16-ish ratio matching the reels themselves):**
- Poster image from T5671 (`/api/projects/{id}/poster.jpg`), `object-cover`; skeleton shimmer
  while loading; branded gradient + reel name as the no-poster/404 fallback
- Overlaid (bottom gradient scrim, style-guide rule "text over video needs backdrop"):
  name, game-time (`11'45"`), status chip (Done / In Overlay / Not Started)
- Slim segmented progress strip at the tile base (reuse `SegmentedProgressStrip` logic,
  restyled to fit the tile width)
- Tag chips only if they fit one line; otherwise drop (tiles are for scanning, the editor has
  the detail)
- Primary tap = same navigation as today's card click; "Move to My Reels", preview, delete
  move into the existing hover-action pattern on desktop / long-press sheet on mobile
  (precedent: `GameCard` already does hover-vs-long-press)

**Carousel (net-new shared component, epic decision #2):**
- CSS `overflow-x-auto` + `snap-x snap-mandatory`, `scrollbar-hide` (utility exists in
  `index.css:25-31`); native momentum swipe on touch
- Desktop (`fine-pointer`): chevron buttons at row edges, shown on row hover; buttons scroll
  by a page of tiles
- Tile width responsive: ~40vw mobile (2.5 tiles visible, affordance that the row scrolls),
  fixed ~160–180px desktop
- No JS carousel library; no persisted scroll state (epic decision #3)

**Layout:** the home column widens for the drafts tab (carousels want width — this is the
desktop dead-space fix); filters keep working exactly as today (chips filter tiles within each
row; a game with zero matches hides its row).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — drafts list `:987-1045`, `ProjectCard:1789`, `SegmentedProgressStrip:1604`, grouping memo `:342-403`, filters `:865-977`
- `src/frontend/src/components/shared/CollapsibleGroup.jsx` — group header (dot counts) reused as carousel row header
- `src/frontend/src/screens/ProjectsScreen.jsx` — screen/data container (should not need data changes beyond poster URL)
- NEW `src/frontend/src/components/shared/CardCarousel.jsx` — the carousel primitive
- NEW extracted `DraftTile.jsx` (from ProjectCard) — extraction is a mechanical commit, restyle a separate commit (refactoring rule #3)
- `src/frontend/src/index.css` — snap utilities if any needed beyond Tailwind
- `.claude/references/ui-style-guide.md` + frontend ui-style-guide skill — document tile + carousel patterns (same PR, epic decision #5)

### Related Tasks
- Depends on: T5671 (poster endpoint) — hard blocker
- Coordinates with: T5675 (also edits `ProjectManager.jsx` — do not run concurrently)
- Blocks: T5673 (reuses `CardCarousel` + tile styling)

### Technical Notes
- **Persistence untouched.** This is pure view-layer; card actions keep calling the exact same
  handlers. No new state stores; expanded/scroll/filter state stays ephemeral.
- **MVC:** `CardCarousel` and `DraftTile` are presentational (Views); ProjectManager keeps the
  logic. Follow the `mvc-pattern` skill.
- Keep the Games tab as-is in this task (its card works; T5675 handles its legibility).
- Poster `<img>` needs `loading="lazy"` — 13+ tiles per row must not fire 13 eager requests.
- Touch floors: chevrons and tile actions ≥44px coarse-pointer (T5360/T5430 pattern).
- UI Designer agent pass before implementation (this is the epic's flagship visual change);
  screenshots in the audit set the baseline.

## Implementation

### Steps
1. [ ] UI Designer: tile + row spec (dimensions, scrim, states) against style guide — user approval
2. [ ] Mechanical extraction: `ProjectCard`→`DraftTile.jsx` file move, no behavior change, own commit
3. [ ] Build `CardCarousel` (snap scroll, fine-pointer chevrons)
4. [ ] Restyle drafts tab: rows-per-game with tiles; wire poster URLs + fallback + lazy loading
5. [ ] Filters/status logic re-verified against tiles (counts, hidden empty rows)
6. [ ] Unit tests (tile states, fallback) + E2E (row scrolls, tile opens draft, filter hides row) + T4930 matrix run
7. [ ] Style guide + knowledge doc updates

## Acceptance Criteria

- [ ] Drafts render as poster tiles in one horizontal carousel per game, desktop and mobile
- [ ] Mobile 390px: swipe scrolls the row; partial next tile visible; no horizontal page overflow
- [ ] Desktop 1280px+: hover chevrons page the row; layout uses the wide viewport (no 2/3-empty screen)
- [ ] Draft with no poster (404) shows branded fallback tile, not a broken image
- [ ] Status, game-time, and framing/overlay progress readable on every tile
- [ ] All existing card actions reachable (open, preview, move to My Reels, rename, delete)
- [ ] Real-browser screenshot evidence at 390px and 1280px+; T4930 usability matrix green
- [ ] Frontend unit + E2E tests pass
