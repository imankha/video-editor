# style-btn-variant

**Priority:** HIGH
**Category:** Buttons

## Rule
Use the correct button variant based on the action type. Never style buttons manually when a variant exists.

## Variant Guide

| Action Type | Variant | Examples |
|-------------|---------|----------|
| Main CTA, confirm, save | `primary` | Save Project, Export, Confirm |
| Cancel, back, neutral | `secondary` | Cancel, Back, Close |
| Add, create, positive | `success` | Add Game, New Project, Play |
| Delete, remove, destructive | `danger` | Delete, Remove, Clear |
| Toolbar, minimal | `ghost` | Settings icon, toolbar buttons |
| Secondary emphasis | `outline` | Learn More, View Details |

## Incorrect Example

```jsx
// BAD: Manual styling instead of using variant
<button className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg">
  Save
</button>

// BAD: Wrong variant for action
<Button variant="danger">Save Project</Button>  // Save isn't destructive!
<Button variant="primary">Cancel</Button>       // Cancel should be secondary
```

## Correct Example

```jsx
import { Button } from '@/components/shared';

// Primary for main action
<Button variant="primary" icon={Save}>Save Project</Button>

// Secondary for cancel/back
<Button variant="secondary" icon={ArrowLeft}>Back</Button>

// Success for add/create
<Button variant="success" icon={Plus}>Add Game</Button>

// Danger for delete (with confirmation pattern)
<Button variant="danger" icon={Trash2}>Delete</Button>

// Ghost for toolbar
<Button variant="ghost" icon={Settings} iconOnly />
```

## Additional Context

The Button component handles:
- Consistent colors and hover states
- Proper padding and sizing
- Icon placement and spacing
- Disabled and loading states
- Focus rings for accessibility

Never bypass the component with manual Tailwind classes unless you have a truly unique case not covered by any variant.
