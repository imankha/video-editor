# UI Style Guide

Style guidelines for the video editor UI. Maintained by the UI Designer agent.

---

## Design Philosophy

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Content First** | Video content is the star; UI should recede |
| **Progressive Disclosure** | Show essentials, reveal details on demand |
| **Immediate Feedback** | Every action has visible response |
| **Forgiveness** | Easy to undo, hard to lose work |

### Video Editor Conventions

Follow established patterns from professional editors (Premiere, DaVinci, CapCut):
- Dark theme to reduce eye strain and make video content pop
- Timeline at bottom, preview at top
- Tools/properties in sidebars
- Minimal chrome around video preview

---

## Color System

### Base Palette (Dark Theme)

| Token | Value | Usage |
|-------|-------|-------|
| `bg-gray-900` | #111827 | Primary background |
| `bg-gray-800` | #1f2937 | Elevated surfaces (panels, cards) |
| `bg-gray-700` | #374151 | Interactive elements (hover states) |
| `border-gray-700` | #374151 | Subtle borders |
| `border-gray-600` | #4b5563 | Emphasized borders |

### Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| `text-white` | #ffffff | Primary text |
| `text-gray-300` | #d1d5db | Secondary text |
| `text-gray-500` | #6b7280 | Disabled/placeholder text |
| `blue-500` | #3b82f6 | Primary actions, selection |
| `green-500` | #22c55e | Success, enabled states |
| `yellow-500` | #eab308 | Warnings, in-progress |
| `red-500` | #ef4444 | Errors, destructive actions |

### State Colors

| State | Background | Border | Text |
|-------|------------|--------|------|
| Default | `bg-gray-800` | `border-gray-700` | `text-white` |
| Hover | `bg-gray-700` | `border-gray-600` | `text-white` |
| Active/Selected | `bg-blue-600` | `border-blue-500` | `text-white` |
| Disabled | `bg-gray-800/50` | `border-gray-700/50` | `text-gray-500` |

---

## Typography

### Font Stack
```css
font-family: system-ui, -apple-system, sans-serif;
font-family: ui-monospace, monospace; /* for timecodes */
```

### Scale

| Size | Class | Usage |
|------|-------|-------|
| 12px | `text-xs` | Labels, timestamps, metadata |
| 14px | `text-sm` | Body text, buttons, inputs |
| 16px | `text-base` | Headings in panels |
| 18px | `text-lg` | Section titles |
| 24px | `text-2xl` | Page titles (rare) |

### Weights
- `font-normal` (400): Body text
- `font-medium` (500): Labels, buttons
- `font-semibold` (600): Headings

---

## Spacing

### Base Unit
4px grid system (Tailwind default)

### Common Patterns

| Context | Padding | Gap |
|---------|---------|-----|
| Buttons | `px-3 py-1.5` | - |
| Cards/Panels | `p-4` | - |
| Form groups | - | `gap-2` |
| Toolbar items | `px-2 py-1` | `gap-1` |
| List items | `px-3 py-2` | - |

---

## Components

### Buttons

```jsx
// Primary action
<button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded">
  Export
</button>

// Secondary action
<button className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded">
  Cancel
</button>

// Icon button (toolbar)
<button className="p-2 hover:bg-gray-700 rounded text-gray-300 hover:text-white">
  <Icon size={16} />
</button>

// Destructive
<button className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded">
  Delete
</button>
```

### Inputs

```jsx
// Text input
<input className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none" />

// Select
<select className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:border-blue-500 focus:outline-none">
```

### Cards/Panels

```jsx
<div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
  <h3 className="text-sm font-medium text-white mb-2">Panel Title</h3>
  {/* content */}
</div>
```

### Toggle States

```jsx
// ON state
<div className="text-green-500">
  <Icon size={16} />
</div>

// OFF state (with slash indicator)
<div className="relative text-gray-500">
  <Icon size={16} />
  <div className="absolute inset-0 flex items-center justify-center">
    <div className="w-5 h-0.5 bg-red-500 rotate-45" />
  </div>
</div>
```

---

## Home / Card Patterns

### Brand lockup (`LogoWithText`)

One intentional horizontal unit — emblem left of a **single-line** "Reel Ballers"
wordmark. Never force a fixed-width column (the old `w-[80px]` column split the
wordmark into stacked "Reel" / icon / "Ballers" lines — a wrap accident, banned).

```jsx
<div className="inline-flex items-center gap-2 sm:gap-3">
  <Logo size={40} />
  <span className="text-2xl sm:text-3xl font-bold text-white leading-none tracking-tight whitespace-nowrap">
    Reel Ballers
  </span>
</div>
```

- `whitespace-nowrap` guarantees the wordmark never re-wraps.
- Sizes to content; center via the parent (`mx-auto` / `justify-center`).
- Sizes in use: hero 40px / `text-2xl→3xl`, sign-in 64px / `text-xl`, end-card 112px / `text-3xl`.

### Labeled metadata pill (rating / count chips)

Generalized from `TagBadges`. Card metadata must be legible to a non-expert: bare
dates, bare scores, and developer notation (chess `!!`/`!`) never reach the UI — the
notation stays in constants (`RATING_NOTATION`), the UI shows the adjective.

```jsx
<span
  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-semibold"
  style={{ color: RATING_BADGE_COLORS[r], backgroundColor: RATING_BACKGROUND_COLORS[r], borderColor: `${RATING_BADGE_COLORS[r]}4D` }}
  title={label}
  aria-label={label}
>
  <Star size={10} />{count} {RATING_ADJECTIVES[r]}
</span>
```

- Every rating/score chip carries a human `title` **and** `aria-label`.
- Label the noun a value measures: `Uploaded 6/11/2026` (not `6/11/2026`),
  `Footage quality 25/100` (not `Quality: 25`).

### Borderless inline filter rows

Filter chip groups are borderless — an inline uppercase label followed by wrapping
chips. Card chrome (`bg-gray-800/50 border rounded-lg`) is reserved for content
cards, NOT control clusters (it adds weight, not meaning).

```jsx
<div className="flex flex-wrap items-center gap-1.5">
  <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mr-1">Status</span>
  {/* chip buttons: px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded */}
</div>
```

- Dense `text-xs` chips get `coarse-pointer:min-h-[44px]` so mobile taps meet the
  44px floor while desktop stays compact.

### Compact resume strip (2-item "continue")

The "Continue Where You Left Off" strip is a 2-up `flex-1` row of buttons, shown on
ALL widths (do not hide on mobile — resume is the highest-value mobile tap). Mobile
drops the secondary metadata line (`hidden sm:block`) and shows icon + truncated
name + chevron; `min-h-[44px]`. Distinct from the many-item carousel.

### Poster tile (`DraftTile`)

A reel rendered as a portrait **9:16** poster tile (Netflix idiom) — the home
surface is a *video* product, so drafts scan by image, not text (T5672).

```jsx
<div className="group/tile relative shrink-0 snap-start w-[40vw] max-w-[200px] sm:w-[168px]
                aspect-[9/16] rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
  <img src={`/api/projects/${id}/poster.jpg`} loading="lazy"
       onLoad={...} onError={...}
       className="absolute inset-0 w-full h-full object-cover" />
  {/* loading  -> <div className="absolute inset-0 bg-gray-700 animate-pulse" />        */}
  {/* 404/error-> branded gradient (from-cyan-900 via-gray-800 to-gray-900) + reel name */}
  <span className="absolute top-1.5 right-1.5 ... bg-black/60 backdrop-blur-sm">{status}</span>
  <div className="absolute inset-x-0 bottom-0 px-2 pt-8 pb-3
                  bg-gradient-to-t from-black/85 via-black/45 to-transparent">
    <h3 className="text-white text-xs font-medium line-clamp-2">{name}</h3>
    <span className="text-[11px] text-gray-300">{gameClock}</span>  {/* 11'45" */}
  </div>
  <SegmentedProgressStrip variant="slim" ... />   {/* h-1.5, pinned to base, still clickable */}
</div>
```

- **Poster is lazy** (`loading="lazy"`) — a row of 13+ tiles must not fire eager
  requests. Poster endpoint 404s when none exists → render the branded fallback,
  never a broken `<img>`.
- Posters are the clip's clearest *source* frame at native aspect (often landscape),
  so `object-cover` center-crops into the portrait tile — expect edge cropping.
- Widths: `40vw` mobile (≈2.5 tiles visible = scroll affordance), fixed `168px` ≥sm.
- Text over the poster always sits on a bottom scrim (the "text over video needs a
  backdrop" rule). One tag chip max, `hidden sm:inline-flex` (dropped on narrow tiles).
- A short status chip AND the slim progress strip both appear — the chip is the
  coarse state, the strip stays the granular deep-link into Framing/Overlay.
- Ready-to-publish tiles get a persistent corner badge (`aria-label="Move to My
  Reels"`) that publishes on tap; the same action also lives in the hover/long-press
  action set. Actions reveal on `group-hover/tile` (desktop) or long-press (mobile),
  with `coarse-pointer:min-h-[44px]` floors.

### Published-reel tile (`ReelTile`)

The My Reels drawer's poster tile (T5673) — the celebration-surface counterpart to
`DraftTile`. Same poster idiom (lazy `<img>` → skeleton → branded fallback, bottom
name/meta scrim, hover/long-press action set) but **without draft-progress chrome**:
published reels have no Framing/Overlay pipeline, so there is NO `SegmentedProgressStrip`,
status chip, or "Ready" publish badge.

- **Poster source:** `GET /api/downloads/{id}/poster.jpg` (the owner-facing endpoint
  for the T5280 publish poster; per-profile, 404 → branded fallback). NOT the draft
  endpoint (`/api/projects/{id}/poster.jpg`).
- **Per-reel aspect (differs from DraftTile's fixed 9:16):** a 9:16 reel renders a
  portrait tile (`w-[42vw] max-w-[168px] sm:w-[150px] aspect-[9/16]`), a 16:9 reel a
  landscape tile (`w-[72vw] max-w-[300px] sm:w-[260px] aspect-video`). Each ratio
  collection renders its OWN `CardCarousel`, so tiles in a row share an aspect (rows
  stay even within a carousel; only across carousels do heights differ).
- **Actions:** play + share/copy direct, plus a kebab for the overflow set (Download,
  Copy Link/Share, Rename, Before/After [dev], Open as Draft, **Move to profile…**,
  Delete). Same `group-hover/tile` / long-press reveal and `coarse-pointer:min-h-[44px]`
  floors as DraftTile. Rename lives in the kebab (there is no click-the-name affordance).
- Move-to-profile (T5678) is a per-reel action with a two-step confirm (pick profile →
  "Move to <name>?"); the old batch **Select** mode was removed from the drawer.

### Game tile (`GameTile`)

The Games tab's poster tile (T5681) — a landscape **16:9** tile (game footage aspect)
rendered in a chronological responsive grid. Unlike DraftTile (portrait, single-game
progress pipeline) and ReelTile (per-profile reel aspect), GameTile uses a fixed
landscape aspect and groups games by month with game-count badges.

- **Poster source:** `GET /api/games/{id}/poster.jpg` (owner-facing endpoint for the
  game's recap poster; per-profile, generate-on-first-request, 404 → branded fallback).
- **Grid layout:** Responsive CSS grid:
  - Mobile (390px): `grid-cols-2` gap-2
  - Tablet (768px): `grid-cols-3` gap-3
  - Desktop (1280px+): `grid-cols-6` gap-4
- **Minimal overlay** (always visible): bottom gradient scrim `from-black/90 via-black/40
  to-transparent`, contains date + clip count in `text-xs` (no game name on tile).
- **Expiry chip** (top-right, if applicable): `bg-yellow-900/70 text-yellow-300`,
  shows "Expired" or "{N}d left" (days until expiry). Only visible on near/expired games.
- **Expired variant:** `grayscale filter opacity-60` on the poster, border `border-yellow-800/40`
  instead of `border-gray-700`, primary action is Extend (if eligible) or Play Recap (fallback).
- **Actions** (reveal on `group-hover:` desktop / long-press 500ms mobile):
  - Play Recap (if recap exists)
  - Share Game (not on expired games)
  - Edit Game (always)
  - Extend Storage (if near/expired & eligible)
  - Delete Game (with 3s confirm on second click)
- **Poster loading:** Skeleton pulse (gray-700 animate-pulse) until loaded; 404 → branded
  fallback (⚾ icon + "Reel Ballers" + "No poster" text on a gradient to-gray-900).
- **Month grouping:** Games sorted chronological descending (newest first), grouped by
  "Month Year" (e.g. "September 2026"). Header shows count badge: "September 2026 • 6 games".
- **Container width:** `max-w-6xl` (same as the Reel Drafts grid to maximize canvas for
  landscape tiles). Games tab only; Projects tab stays `max-w-6xl` (Reel Drafts).

### Card carousel (`CardCarousel`)

One horizontal, snap-scrolling row per group (e.g. a game's drafts). Presentational,
**no persisted scroll state** — position is ephemeral DOM state. No JS carousel library.

```jsx
<div className="relative group/row">
  <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide scroll-smooth px-1 pb-1">
    {tiles}   {/* each: shrink-0 snap-start */}
  </div>
  {/* chevrons: desktop-only, on row hover; page by ~one visible width */}
  <button className="hidden fine-pointer:group-hover/row:flex absolute left-0 inset-y-0 w-10 ...">
    <ChevronLeft />
  </button>
</div>
```

- Touch = native momentum swipe + snap (no chevrons on coarse pointers, so no 44px
  concern for them). Desktop = `fine-pointer:` chevrons that `scrollBy(clientWidth * 0.85)`.
- `scrollbar-hide` utility lives in `src/frontend/src/index.css` (hides the native bar).
- The per-group header (game name + status dot-counts) stays a `CollapsibleGroup`; the
  carousel is its collapsible child (rows still collapse).

---

## Layout Patterns

### Mode Views (Annotate, Framing, Overlay)

```
┌─────────────────────────────────────────────────┐
│ Header (mode tabs, global actions)              │
├─────────┬───────────────────────────┬───────────┤
│ Left    │                           │ Right     │
│ Panel   │    Video Preview          │ Panel     │
│ (tools) │                           │ (props)   │
├─────────┴───────────────────────────┴───────────┤
│ Timeline / Clip List                            │
└─────────────────────────────────────────────────┘
```

### Timeline Layers

```jsx
// Layer row
<div className="h-8 flex items-center border-b border-gray-700/50 bg-gray-900">
  <div className="w-8 flex items-center justify-center">
    <Icon size={16} />
  </div>
  <div className="flex-1">
    {/* layer content */}
  </div>
</div>
```

---

## Icons

### Library
Using **Lucide React** for consistency.

### Sizes
- 14px: Inline with text
- 16px: Buttons, list items (default)
- 20px: Emphasized actions
- 24px: Large touch targets

### Common Icons

| Action | Icon |
|--------|------|
| Play | `Play` |
| Pause | `Pause` |
| Export | `Download` |
| Delete | `Trash2` |
| Settings | `Settings` |
| Add | `Plus` |
| Close | `X` |
| Visibility ON | Icon without slash |
| Visibility OFF | Icon with red slash overlay |

---

## Motion

### Transitions
```css
transition-colors    /* color changes */
transition-opacity   /* fade in/out */
transition-transform /* scale, translate */
duration-150         /* quick interactions */
duration-300         /* panel animations */
```

### Hover States
- Color shift: `hover:bg-gray-700`
- Always provide visual feedback
- Keep transitions snappy (150ms)

---

## Accessibility

### Minimum Requirements
- Color contrast: 4.5:1 for text
- Focus visible: `focus:ring-2 focus:ring-blue-500`
- Touch targets: 44px minimum for mobile
- Keyboard navigation: all interactive elements

### ARIA Patterns
- Use semantic HTML first
- Add `aria-label` for icon-only buttons
- Use `role="button"` for clickable divs

---

## Anti-Patterns

### Don't Do This

| Anti-Pattern | Why | Instead |
|--------------|-----|---------|
| White backgrounds | Harsh on eyes, fights with video | Use `bg-gray-800` or darker |
| Bright colored panels | Distracts from content | Muted grays |
| Heavy borders | Visual clutter | Subtle `border-gray-700` |
| Inconsistent spacing | Feels unpolished | Stick to 4px grid |
| Text over video without backdrop | Unreadable | Add `bg-black/50` backdrop |

---

## Changelog

| Date | Change | Approved By |
|------|--------|-------------|
| 2026-02-09 | Initial style guide created | - |
| 2026-07-22 | Home/card patterns: brand lockup, labeled metadata pills, borderless filter rows, compact resume strip (T5675) | user |
| 2026-07-23 | Poster tile (`DraftTile`, 9:16, scrim, lazy poster + branded fallback) and card carousel (`CardCarousel`, snap-scroll + fine-pointer chevrons) patterns (T5672) | user |
| 2026-07-23 | Published-reel tile (`ReelTile`) for the My Reels drawer: DraftTile idiom minus draft chrome, per-reel aspect (9:16/16:9), owner poster endpoint `/api/downloads/{id}/poster.jpg`, tiles laid out in `CardCarousel`; batch Select removed, per-reel Move-to-profile with confirm (T5673/T5678) | user |
| 2026-07-24 | Games tab poster grid (`GameTile`, 16:9 landscape, chronological grid 2-up mobile / 3-up tablet / 6-up desktop, month grouping with game-count badges, minimal overlay date+clip-count, top-right expiry chip, grayscale expired variant, poster endpoint `/api/games/{id}/poster.jpg`) (T5681) | user |
