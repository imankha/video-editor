# T1550: Unified navigation — consistent breadcrumbs, mode tabs, and clickable indicators

**Status:** TODO
**Priority:** P2 (UX confusion)
**Impact:** 6 (users can't distinguish indicators from buttons; navigation model breaks between modes)
**Complexity:** 5
**Created:** 2026-04-17

## Problem

The app has three navigation concerns — location (where am I?), mode (which editor?), and back-navigation (how do I go up?) — but they're implemented inconsistently across screens, breaking the user's mental model.

### Issue 1: Mode indicator vs mode tabs

1. **Annotate mode** shows a green badge (`bg-green-600/20`, scissors icon) in the header. It looks like a button (colored bg, rounded, icon + label) but is **not clickable** — it's a "you are here" indicator.

2. **Framing/Overlay mode** shows a `ModeSwitcher` with two **clickable tabs** (`Framing | Overlay`). Active tab is colored, inactive is gray with hover states.

3. There's also an "Edit in Annotate" button in App.jsx that appears when a clip is selected in Framing — a third navigation pattern for the same concept.

The Annotate indicator uses the **same visual language** as the clickable ModeSwitcher tabs, so users can't distinguish "current location" from "click to navigate."

### Issue 2: Breadcrumbs are not clickable

The `Breadcrumb` component shows hierarchy (e.g., `Games › Game Name` or `Reels › Reel Name`) but segments are plain text — not links. Standard breadcrumb UX makes each segment clickable to navigate to that level:

- Click "Games" → Home screen with Games tab selected
- Click "Reels" → Home screen with Reels tab selected
- The final segment (item name) stays non-clickable (you're already there)

### Issue 3: Two separate header layouts

- **AnnotateScreen** renders its own header with Home button + Breadcrumb (`Games › Game Name`) + Annotate badge
- **App.jsx** renders a different header with Home button + Breadcrumb (`Reels › Reel Name`) + ModeSwitcher + "Edit in Annotate" button

Same purpose, different layout, different components, different behavior.

### Where the components live today

| Component | File | Interactive? |
|-----------|------|-------------|
| Breadcrumb (non-clickable) | `components/shared/Breadcrumb.jsx` | No — plain text |
| Annotate badge (non-clickable) | `AnnotateScreen.jsx:471-474` | No — visual indicator |
| ModeSwitcher (clickable tabs) | `components/shared/ModeSwitcher.jsx` | Yes — Framing/Overlay only |
| "Edit in Annotate" button | `App.jsx:541-549` | Yes — separate from ModeSwitcher |
| Home button (Annotate) | `AnnotateScreen.jsx:443-448` | Yes — navigates to ProjectsScreen |
| Home button (Framing/Overlay) | `App.jsx:521-527` | Yes — navigates to ProjectsScreen |

## Goal

### 1. Unified mode tabs

All three modes in a single tab bar, always in the same header position:

```
[ Annotate | Framing | Overlay ]
```

- **Active mode:** Colored background (green/blue/purple per mode)
- **Available mode:** Gray text, hover state, cursor:pointer — clearly clickable
- **Unavailable mode:** Dimmed, cursor:not-allowed, tooltip (e.g., "Create a reel first")

#### Navigation rules

| From | To | Condition |
|------|----|-----------|
| Annotate → Framing | Click Framing tab | A reel must exist for this game |
| Annotate → Overlay | Click Overlay tab | Reel must have a working video |
| Framing → Annotate | Click Annotate tab | Always available |
| Framing → Overlay | Click Overlay tab | Reel must have a working video (existing) |
| Overlay → Annotate | Click Annotate tab | Always available |
| Overlay → Framing | Click Framing tab | Always available (existing) |

### 2. Clickable breadcrumbs

Each breadcrumb segment navigates to that level:

```
Games › SoCal Blaze vs Nov 11        (in Annotate mode)
Reels › Spring 2026                   (in Framing/Overlay mode)
```

- Click **"Games"** → Home screen, Games tab selected
- Click **"Reels"** → Home screen, Reels tab selected
- **Item name** (final segment) → not clickable (current location)
- Hover on clickable segments: underline + cursor:pointer
- Clickable segments: `text-gray-400 hover:text-white hover:underline cursor-pointer`
- Current item: `text-white font-semibold` (no hover, no pointer)

Home needs to accept an `initialTab` parameter so the breadcrumb can deep-link:
- `handleModeChange(EDITOR_MODES.PROJECT_MANAGER, { tab: 'games' })`
- `handleModeChange(EDITOR_MODES.PROJECT_MANAGER, { tab: 'reels' })`

### 3. Single header component

Extract a shared `EditorHeader` component used by both AnnotateScreen and App.jsx:
- Left: Home button + Breadcrumb (clickable)
- Right: CreditBalance + GalleryButton + SignInButton + ModeSwitcher (unified 3-tab)
- Same layout, same position, same behavior across all modes

### What to remove

- The standalone green Annotate badge in AnnotateScreen header
- The Annotate fallback indicator in ModeSwitcher
- The separate "Edit in Annotate" button in App.jsx (absorbed into unified tabs)
- Duplicate header layouts in AnnotateScreen vs App.jsx

## Design principles

1. **Consistent position** — navigation elements always in the same location across all modes
2. **Visual distinction** — clickable items have hover/pointer states; static items don't look interactive
3. **Standard breadcrumbs** — each segment is a link to that hierarchy level (universally understood pattern)
4. **Progressive disclosure** — unavailable modes are visible but disabled with tooltips
5. **Single source of truth** — one header component, not two separate implementations

## Acceptance criteria

1. All three modes appear in a single tab bar in the same header position
2. Active mode is visually distinct (colored) but same shape as inactive tabs
3. Inactive clickable tabs have hover states and cursor:pointer
4. Unavailable tabs are dimmed with tooltip explaining the prerequisite
5. Breadcrumb category ("Games" / "Reels") is clickable and navigates to Home with that tab selected
6. Breadcrumb item name is not clickable (you're already viewing it)
7. No standalone mode indicators or separate navigation buttons for the same concept
8. Single shared header component across all editor modes
9. Mobile: icon-only tabs (scissors, crop, layers) with same active/inactive states
