---
name: ui-style-guide
description: "Visual design system for the Reel Ballers video editor. Colors, buttons, spacing, components. Apply when creating UI components or styling elements."
license: MIT
author: video-editor
version: 1.0.0
---

# UI Style Guide

Visual design patterns for consistent UI across the application.

## When to Apply
- Creating new UI components
- Styling existing elements
- Choosing button variants
- Setting colors, spacing, typography

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Colors | HIGH | `style-color-` |
| 2 | Buttons | HIGH | `style-btn-` |
| 3 | Spacing | MEDIUM | `style-space-` |
| 4 | Components | MEDIUM | `style-comp-` |

---

## Color Palette

### Brand Colors
| Color | Tailwind | Hex | Usage |
|-------|----------|-----|-------|
| Purple | `purple-600` | #9333EA | Primary brand, main actions |
| Green | `green-600` | #16A34A | Success, add, annotate mode |
| Blue | `blue-600` | #2563EB | Framing mode, informational |

### Semantic Colors
| Purpose | Base | Hover | Usage |
|---------|------|-------|-------|
| Primary | `purple-600` | `purple-700` | Main CTAs |
| Success | `green-600` | `green-700` | Add, play, load |
| Danger | `red-600` | `red-700` | Delete, destructive |
| Secondary | `gray-700` | `gray-600` | Cancel, neutral |

### Background Colors
| Element | Color | Usage |
|---------|-------|-------|
| App | `gray-900` | Main background |
| Card | `gray-800` | Cards, modals |
| Hover | `gray-700` | Interactive elements |

---

## Button Component

Use `<Button>` from `components/shared/Button.jsx`:

```jsx
import { Button } from '@/components/shared';

// Variants
<Button variant="primary">Save</Button>     // Purple - main actions
<Button variant="secondary">Cancel</Button> // Gray - neutral
<Button variant="success">Add</Button>      // Green - positive
<Button variant="danger">Delete</Button>    // Red - destructive
<Button variant="ghost">Settings</Button>   // Minimal - toolbars

// With icons
<Button variant="primary" icon={Plus}>New Project</Button>
<Button variant="ghost" icon={Settings} iconOnly />

// Sizes
<Button size="sm">Small</Button>  // Compact UI
<Button size="md">Medium</Button> // Default
<Button size="lg">Large</Button>  // CTAs
```

---

## Spacing Scale

| Size | Class | Usage |
|------|-------|-------|
| Tight | `gap-1` | Icon + text |
| Default | `gap-2` | Button content |
| Comfortable | `gap-3` | Button groups |
| Spacious | `gap-4` | Sections |

### Padding
| Element | Padding |
|---------|---------|
| Small button | `px-3 py-1.5` |
| Medium button | `px-4 py-2` |
| Large button | `px-6 py-3` |
| Card | `p-4` |
| Modal section | `px-6 py-4` |

---

## Typography

| Element | Classes |
|---------|---------|
| Page title | `text-4xl font-bold text-white` |
| Section title | `text-2xl font-bold text-white` |
| Card title | `text-lg font-semibold text-white` |
| Body | `text-sm text-gray-300` |
| Label | `text-sm text-gray-400` |
| Small | `text-xs text-gray-500` |

---

## Common Patterns

### Card
```jsx
<div className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-purple-500">
  {/* content */}
</div>
```

### Modal
```jsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-gray-700">
    <div className="px-6 py-4 border-b border-gray-700">Header</div>
    <div className="px-6 py-4">Body</div>
    <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
      <Button variant="secondary">Cancel</Button>
      <Button variant="primary">Confirm</Button>
    </div>
  </div>
</div>
```

### Input
```jsx
<input className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500" />
```

---

## Complete Rules

See individual rule files in `rules/` directory.
See also: `src/frontend/src/STYLE_GUIDE.md` for full visual reference.
