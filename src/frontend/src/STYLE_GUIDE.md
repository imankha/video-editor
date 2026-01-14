# Reel Ballers Style Guide

This document defines the visual design system for the Reel Ballers video editor application.

## Color Palette

### Brand Colors
| Color | Tailwind Class | Hex | Usage |
|-------|---------------|-----|-------|
| Purple | `purple-600` | #9333EA | Primary brand, main actions, overlay mode |
| Green | `green-600` | #16A34A | Success, positive actions, games/annotate mode |
| Blue | `blue-600` | #2563EB | Framing mode, informational |

### Semantic Colors
| Purpose | Base | Hover | Usage |
|---------|------|-------|-------|
| Primary Action | `purple-600` | `purple-700` | Main CTAs, confirmations |
| Success/Add | `green-600` | `green-700` | Add, play, load, export success |
| Danger/Delete | `red-600` | `red-700` | Delete, destructive actions |
| Secondary | `gray-700` | `gray-600` | Cancel, back, neutral |
| Framing Mode | `blue-600` | `blue-700` | Framing-specific actions |

### Background Colors
| Element | Color | Usage |
|---------|-------|-------|
| App Background | `gray-900` | Main background |
| Card/Panel | `gray-800` | Cards, modals, panels |
| Hover State | `gray-700` | Button hovers, interactive elements |
| Border | `gray-700` / `gray-600` | Dividers, borders |

### Text Colors
| Type | Color | Usage |
|------|-------|-------|
| Primary Text | `white` | Headings, button text |
| Secondary Text | `gray-400` | Descriptions, labels |
| Muted Text | `gray-500` | Hints, disabled text |
| Icon Accent | `purple-400` / `green-400` | Icon colors |

---

## Typography

### Font Stack
The app uses the system font stack via Tailwind's default sans-serif:
```
font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"
```

### Text Sizes
| Element | Class | Usage |
|---------|-------|-------|
| Page Title | `text-4xl font-bold` | Main headings |
| Section Title | `text-2xl font-bold` | Section headings |
| Card Title | `text-lg font-semibold` | Card/modal titles |
| Body Text | `text-sm` | Default body text |
| Small Text | `text-xs` | Labels, badges, hints |

### Text Styles
| Style | Classes | Usage |
|-------|---------|-------|
| Heading | `text-white font-bold` | Titles |
| Label | `text-gray-400 text-sm` | Form labels, descriptions |
| Uppercase Label | `text-gray-400 text-sm uppercase tracking-wide` | Section labels |

---

## Buttons

### Button Variants

Use the `<Button>` component from `components/shared/Button.jsx`:

```jsx
import { Button } from './components/shared';
```

#### Primary (Purple)
For main actions and confirmations.
```jsx
<Button variant="primary">Save Project</Button>
<Button variant="primary" icon={Plus}>New Project</Button>
```

#### Secondary (Gray)
For cancel, back, and neutral actions.
```jsx
<Button variant="secondary">Cancel</Button>
<Button variant="secondary" icon={ArrowLeft}>Back</Button>
```

#### Success (Green)
For positive actions like add, play, load.
```jsx
<Button variant="success">Add Game</Button>
<Button variant="success" icon={Play}>Play</Button>
```

#### Danger (Red)
For destructive actions.
```jsx
<Button variant="danger">Delete</Button>
<Button variant="danger" icon={Trash2}>Remove</Button>
```

#### Ghost
For minimal-style buttons in toolbars.
```jsx
<Button variant="ghost" icon={Settings} iconOnly />
```

#### Outline
For secondary emphasis with border.
```jsx
<Button variant="outline">Learn More</Button>
```

### Button Sizes

| Size | Usage | Padding |
|------|-------|---------|
| `sm` | Toolbars, compact UI | `px-3 py-1.5` |
| `md` | Default, most buttons | `px-4 py-2` |
| `lg` | Primary CTAs | `px-6 py-3` |

```jsx
<Button size="sm">Small</Button>
<Button size="md">Medium</Button>
<Button size="lg">Large</Button>
```

### Icon Buttons

For icon-only buttons, use `iconOnly`:
```jsx
<Button variant="ghost" icon={Play} iconOnly size="sm" />
```

Or use the `IconButton` helper:
```jsx
import { IconButton } from './components/shared/Button';
<IconButton icon={Trash2} variant="danger" />
```

### Button with Badge

For buttons with count badges (like Gallery):
```jsx
<Button variant="ghost" icon={Image}>
  Gallery
  {count > 0 && (
    <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
      {count}
    </span>
  )}
</Button>
```

---

## Spacing

### Standard Gaps
| Size | Class | Usage |
|------|-------|-------|
| Tight | `gap-1` | Icon + text in small buttons |
| Default | `gap-2` | Button content, inline elements |
| Comfortable | `gap-3` | Button groups |
| Spacious | `gap-4` | Section spacing |

### Padding
| Element | Padding | Usage |
|---------|---------|-------|
| Small Button | `px-3 py-1.5` | Compact buttons |
| Medium Button | `px-4 py-2` | Default buttons |
| Large Button | `px-6 py-3` | CTAs |
| Card | `p-4` | Card content |
| Modal | `px-6 py-4` | Modal sections |

---

## Border Radius

| Element | Class | Usage |
|---------|-------|-------|
| Buttons | `rounded-lg` | All buttons |
| Cards | `rounded-lg` | Cards, panels |
| Modals | `rounded-lg` | Modal containers |
| Badges | `rounded-full` | Count badges |
| Progress bars | `rounded` or `rounded-full` | Progress indicators |

---

## Icons

### Icon Library
Use [Lucide React](https://lucide.dev/) for all icons.

### Icon Sizes
| Context | Size | Usage |
|---------|------|-------|
| Small buttons | `14px` | Compact UI |
| Default buttons | `16-18px` | Most buttons |
| Large buttons | `18-20px` | CTAs |
| Headers | `18-24px` | Page headers |
| Large display | `48px` | Empty states |

### Icon Colors
| Context | Color | Usage |
|---------|-------|-------|
| In buttons | Inherit from text | Match button text |
| Accent icons | `text-purple-400` | Purple accent |
| Success icons | `text-green-400` | Green accent |
| Warning icons | `text-yellow-400` | Yellow accent |
| Muted icons | `text-gray-400` | Secondary icons |

---

## Cards & Panels

### Card Structure
```jsx
<div className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-purple-500 transition-all">
  {/* Card content */}
</div>
```

### Interactive Cards
```jsx
<div className="group p-4 bg-gray-800 hover:bg-gray-750 rounded-lg cursor-pointer border border-gray-700 hover:border-purple-500 transition-all">
  {/* Show elements on hover */}
  <button className="opacity-0 group-hover:opacity-100">
    Action
  </button>
</div>
```

---

## Modals & Dialogs

### Modal Structure
```jsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
  <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 border border-gray-700">
    {/* Header */}
    <div className="px-6 py-4 border-b border-gray-700">
      <h3 className="text-lg font-semibold text-white">Title</h3>
    </div>

    {/* Body */}
    <div className="px-6 py-4">
      <p className="text-gray-300">Content</p>
    </div>

    {/* Footer */}
    <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
      <Button variant="secondary">Cancel</Button>
      <Button variant="primary">Confirm</Button>
    </div>
  </div>
</div>
```

---

## Form Elements

### Input Fields
```jsx
<input
  type="text"
  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
  placeholder="Enter text..."
/>
```

### Select Dropdowns
```jsx
<select className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
  <option>Option 1</option>
</select>
```

---

## States

### Disabled State
```jsx
<Button disabled>
  Disabled Button
</Button>
// Applies: opacity-50 cursor-not-allowed
```

### Loading State
```jsx
<Button loading>
  Loading...
</Button>
// Shows spinner, disables interaction
```

### Focus State
All interactive elements should have visible focus states:
```
focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-purple-500
```

### Hover State
- Buttons: Darken by one shade (e.g., `purple-600` -> `hover:purple-700`)
- Cards: `hover:bg-gray-750` or border highlight

---

## Component Quick Reference

### Import Shared Components
```jsx
import { Button, ButtonGroup, IconButton } from './components/shared/Button';
import { ConfirmationDialog } from './components/shared';
```

### Common Button Patterns

**Navigation Button:**
```jsx
<Button variant="secondary" icon={ArrowLeft} onClick={goBack}>
  Projects
</Button>
```

**Add/Create Button:**
```jsx
<Button variant="success" icon={Plus} size="lg">
  Add Game
</Button>
```

**Delete with Confirmation:**
```jsx
<Button
  variant={showConfirm ? 'danger' : 'ghost'}
  icon={Trash2}
  iconOnly
  onClick={handleDelete}
/>
```

**Full-width CTA:**
```jsx
<Button variant="primary" size="lg" fullWidth icon={Download}>
  Export Video
</Button>
```

---

## Migration Checklist

When updating existing buttons to use the Button component:

1. Import the Button component
2. Replace `<button className="...">` with `<Button variant="..." size="...">`
3. Move icons from children to the `icon` prop
4. Remove manual className styling (colors, padding, etc.)
5. Keep only layout-specific classes if needed (e.g., `className="ml-auto"`)
