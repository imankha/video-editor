---
name: responsiveness
description: "Mobile-first responsive design patterns and testing workflow. Apply when making UI work on mobile screens (360-428px) or fixing overflow/layout issues at narrow widths."
license: MIT
author: video-editor
version: 1.0.0
---

# Responsiveness Skill

Patterns and workflow for making the UI work at mobile widths (360-428px) while preserving the desktop experience.

## When to Apply
- Fixing overflow or truncation at narrow screen widths
- Making a new component or screen responsive
- Any task in the Mobile Responsive epic

## Target Widths

| Device | Width | Use |
|--------|-------|-----|
| Small phone | 360px | Minimum supported — everything must fit |
| iPhone 14 | 375px | Primary test width |
| Large phone | 428px | Upper mobile bound |
| Tailwind `sm` | 640px | Breakpoint where mobile → desktop |
| Desktop | 1280px | Verify no regressions |

Always test at **375px** and verify at **360px** and **1280px**.

## Responsive Patterns (Tailwind)

### 1. Hide text, keep icons on mobile

The most effective pattern for nav bars and toolbars. Icons are recognizable; text is a luxury.

```jsx
// Label hidden on mobile, visible on sm+
<button>
  <Icon size={16} />
  <span className="hidden sm:inline">Label</span>
</button>
```

The `title` attribute provides hover tooltip on desktop and long-press on mobile.

### 2. Reduce padding/gaps on mobile

Use responsive padding to reclaim space on small screens.

```jsx
// Container padding
<div className="px-3 py-4 sm:px-4 sm:py-8">

// Gaps between items
<div className="flex items-center gap-1 sm:gap-2">

// Button padding
<button className="px-2 sm:px-4 py-2">

// Card padding
<div className="p-3 sm:p-6">
```

### 3. Stack layouts on mobile

Switch from horizontal to vertical layout at narrow widths.

```jsx
// Side-by-side on desktop, stacked on mobile
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
```

### 4. Truncate text with max-width

For text that can't be hidden (breadcrumbs, titles).

```jsx
<span className="truncate max-w-[120px] sm:max-w-none">
  {longProjectName}
</span>
```

### 5. Wrap instead of overflow

For stat rows or tag lists that overflow at narrow widths.

```jsx
<div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
```

### 6. Hide non-essential sections

Remove entire sections that aren't critical on mobile.

```jsx
<div className="hidden sm:block">
  {/* "Continue Where You Left Off" — nice on desktop, wastes space on mobile */}
</div>
```

### 7. Responsive margins

Reduce vertical spacing between sections on mobile.

```jsx
<div className="mb-4 sm:mb-8">
```

## Core Principle

**It's better to hide functionality that doesn't fit than to show unusable UI.** If a feature can't work well at mobile widths, hide it entirely (`hidden sm:block`) rather than cramming it in at a size where it's broken or frustrating. Unusable UI is worse than missing UI — users can always rotate to landscape or use desktop for advanced features.

**Stack into multiple lines rather than overlap.** When a toolbar or control bar overflows at narrow widths, wrap it into two lines (`flex-wrap` or `flex-col sm:flex-row`) instead of letting items overlap or bleed off-screen. Two readable lines are always better than one unreadable line.

**Never show redundant information.** If a piece of data (name, title, label) is already visible elsewhere on the screen, don't repeat it — regardless of screen width. Redundancy wastes space and adds cognitive load.

## Touch Target Guidelines

Minimum sizes based on Apple HIG, Material Design, and WCAG 2.2. These ensure users can reliably tap targets — including with long fingernails, motor impairments, or one-handed thumb use.

| Metric | Minimum | Preferred | Tailwind |
|--------|---------|-----------|----------|
| Touch target size | 44px | 48px | `min-h-11 min-w-11` / `min-h-12 min-w-12` |
| Gap between targets | 8px | 8-12px | `gap-2` / `gap-3` |
| Icon inside target | 16-24px icon | 48px container | Icon + `p-3` padding |
| List item height | 44px | 48px | `min-h-11` / `min-h-12` |

**Rules:**
- Every tappable element must have at least **44x44px** touch area (visual size can be smaller via padding)
- Minimum **8px gap** between adjacent touch targets to prevent mis-taps
- Icon buttons: use `iconOnly` with padding — the icon can be 16-20px but the button must be 44px+
- Close/dismiss buttons are commonly made too small — always enforce 44px minimum
- On toolbars with many small buttons, use `gap-1 sm:gap-2` minimum (4-8px)

```jsx
// Icon button with proper touch target (icon is 16px, target is 44px)
<button className="p-3 min-h-11 min-w-11">
  <Icon size={16} />
</button>

// Toolbar with minimum spacing
<div className="flex items-center gap-2">
```

## Decision Framework

When a component overflows at 360px, apply fixes in this order:

1. **Hide text labels** — Keep icons, hide `<span>` text with `hidden sm:inline`
2. **Reduce padding/gaps** — `px-2 sm:px-4`, `gap-1 sm:gap-2`
3. **Truncate text** — `truncate max-w-[Npx] sm:max-w-none`
4. **Stack layout** — `flex-col sm:flex-row`
5. **Wrap content** — `flex-wrap` with `gap-x-N gap-y-N`
6. **Hide non-essential sections** — `hidden sm:block`
7. **Hamburger menu** — Last resort, only if icons still overflow at 360px

**Do NOT** use JavaScript for responsive behavior. Tailwind responsive classes handle everything.

## Testing Workflow

### Phase 1: Implement (CSS only)

Make all changes using Tailwind responsive classes (`sm:` prefix for 640px breakpoint). No JS.

### Phase 2: Visual review with user (MANDATORY)

**Always open a headed Playwright browser so the user can see the result and give feedback.**
Use `test-mobile.mjs` (see below) to launch a visible browser, walk through each screen at
each target width, and wait for the user's notes before proceeding. Do NOT mark a responsive
task as tested based solely on headless screenshots — the user must see the live browser and
approve.

Script pattern (`src/frontend/test-mobile.mjs`):

```js
import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // Check overflow
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  console.log('Overflow:', JSON.stringify(overflow));

  // Keep browser open for user review
  console.log('Browser open — review and press Ctrl+C when done');
  await new Promise(() => {}); // Keep alive
}

run().catch(console.error);
```

Walk-through steps:
1. Launch headed at 375px — user reviews home screen
2. Click through tabs (Games, Projects) — user reviews each
3. Resize to 360px — user checks tightest width
4. Resize to 1280px — user verifies no desktop regressions
5. Collect user notes, iterate on fixes, re-run

### Phase 3: Automated checks (headless)

After user approval, run headless verification for CI-style checks:

```js
// In test-mobile.mjs with headless: true
// For each width in [360, 375, 1280]:
// 1. Check overflow: scrollWidth === clientWidth
// 2. Check all visible buttons within viewport bounds
// 3. Take screenshot for the record
```

### Phase 4: Checklist

For every responsive change, verify:

- [ ] No horizontal overflow at 360px (`scrollWidth === clientWidth`)
- [ ] All interactive elements visible and within viewport bounds
- [ ] All buttons tappable (not hidden behind other elements)
- [ ] Text is readable (not clipped mid-word unless using `truncate`)
- [ ] Desktop layout unchanged at 1280px
- [ ] Build passes (`npx vite build`)

## What NOT to Do

- **Don't use media queries in CSS files** — Use Tailwind responsive prefixes
- **Don't use JS to detect screen size** — CSS handles it
- **Don't restructure component logic** — Only change className strings
- **Don't add new wrapper divs** — Modify existing elements
- **Don't change the `sm` breakpoint (640px)** — It's the project standard
- **Don't use `xs:` breakpoint** — Tailwind default doesn't include it; `sm:` is sufficient
- **Don't add `overflow-x-hidden` on body/html** — Fix the root cause instead

## Established Patterns in This Codebase

| Component | Mobile | Desktop |
|-----------|--------|---------|
| Nav buttons (ModeSwitcher, GalleryButton) | Icon only | Icon + text label |
| Breadcrumb project name | Truncated (120px max) | Full text |
| Metadata card (FramingModeView) | Stacked (title above resolution) | Side-by-side |
| Editor area padding | `p-3` | `p-6` |
| Container padding | `px-3 py-4` | `px-4 py-8` |
| Header margin | `mb-4` | `mb-8` |
| "Continue Where You Left Off" | Hidden | Visible |
| Home Gallery button | Icon only | Icon + "Gallery" text |
| Game card stats | `flex-wrap` (wraps to 2 lines) | Single line |
