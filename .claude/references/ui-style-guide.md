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
