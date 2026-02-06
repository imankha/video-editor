# Frontend Guidelines

## Stack
React 18 + Vite + Zustand + Tailwind

## Testing
```bash
npm test                    # Unit tests (Vitest)
npm run test:e2e           # E2E tests (Playwright) - start servers first!
npm run test:e2e -- --ui   # E2E with visual UI
```

---

## Skills

This codebase uses structured skills with prioritized rules. Each skill has a SKILL.md and individual rule files.

**Location:** `.claude/skills/`

| Skill | Priority | Description |
|-------|----------|-------------|
| [data-always-ready](/.claude/skills/data-always-ready/SKILL.md) | CRITICAL | Parent guards data, children assume it exists |
| [mvc-pattern](/.claude/skills/mvc-pattern/SKILL.md) | CRITICAL | Screen → Container → View separation |
| [state-management](/.claude/skills/state-management/SKILL.md) | CRITICAL | Single store ownership, no duplicate state |
| [keyframe-data-model](/.claude/skills/keyframe-data-model/SKILL.md) | HIGH | Frame-based keyframes, origins, state machine |
| [ui-style-guide](/.claude/skills/ui-style-guide/SKILL.md) | MEDIUM | Colors, buttons, spacing, components |

---

## Quick Reference

### Data Always Ready
Components assume data is loaded before rendering. Parents guard, children render.

```jsx
// Good - parent guards
{selectedClip && <ClipEditor clip={selectedClip} />}

// Bad - child checks
function ClipEditor({ clip }) {
  if (!clip) return <Loading />;  // Don't do this
}
```

### MVC Pattern
```
Screen (data fetching, hook initialization)
  └── Container (state logic, event handlers)
        └── View (presentational, props only)
```

### Keyframe Structure
```javascript
keyframe = {
  frame: number,                    // Frame-based, not time
  origin: 'permanent' | 'user' | 'trim',
  // + mode-specific data (x, y, width, height for crop)
}
```

---

## State Management
- **Zustand stores**: Global state (`editorStore`, `exportStore`, etc.)
- **Screen-owned hooks**: Each screen initializes `useVideo`, `useCrop`, etc.
- **No prop drilling from App.jsx**: Screens are self-contained

---

## Don't
- Don't add console.logs in committed code
- Don't fetch data in View components
- Don't render components without data guards
- Don't use localStorage (all persistence via SQLite + R2)
- Don't use time in seconds for keyframes (use frame numbers)
