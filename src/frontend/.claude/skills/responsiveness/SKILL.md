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

### Phase 2: Verify with Playwright MCP

Use the Playwright MCP tools to test at target widths:

```
1. Resize browser to target width:
   mcp__playwright__browser_resize(width: 375, height: 812)

2. Navigate to the page:
   mcp__playwright__browser_navigate(url: "http://localhost:5173")

3. Take screenshot to visually verify:
   mcp__playwright__browser_take_screenshot(type: "png", filename: "mobile-test.png")

4. Check for horizontal overflow:
   mcp__playwright__browser_evaluate(() => ({
     hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
     scrollWidth: document.documentElement.scrollWidth,
     clientWidth: document.documentElement.clientWidth
   }))

5. Verify all interactive elements are positioned within viewport:
   mcp__playwright__browser_evaluate(() => {
     const header = document.querySelector('.flex.items-center.justify-between');
     const buttons = header?.querySelectorAll('button') || [];
     return Array.from(buttons).map(b => ({
       title: b.title || b.textContent?.trim()?.slice(0, 30),
       right: Math.round(b.getBoundingClientRect().right),
       visible: b.offsetParent !== null
     }));
   })

6. Verify at desktop width (no regressions):
   mcp__playwright__browser_resize(width: 1280, height: 800)
   mcp__playwright__browser_take_screenshot(type: "png", filename: "desktop-verify.png")

7. Clean up screenshots when done:
   rm -f mobile-test.png desktop-verify.png
```

### Phase 3: Checklist

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
