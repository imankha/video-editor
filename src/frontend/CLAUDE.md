# Frontend Guidelines

> Full implementation guidelines: [../../.claude/workflows/2-implementation.md](../../.claude/workflows/2-implementation.md)

## Skills

| Skill | Priority | Description |
|-------|----------|-------------|
| [data-always-ready](.claude/skills/data-always-ready/SKILL.md) | CRITICAL | Parent guards data, children assume it exists |
| [mvc-pattern](.claude/skills/mvc-pattern/SKILL.md) | CRITICAL | Screen → Container → View separation |
| [state-management](.claude/skills/state-management/SKILL.md) | CRITICAL | Single store ownership, no duplicate state |
| [naming](.claude/skills/naming/SKILL.md) | HIGH | Name by behavior, not usage context |
| [type-safety](.claude/skills/type-safety/SKILL.md) | HIGH | Use `as const` objects, no magic strings |
| [keyframe-data-model](.claude/skills/keyframe-data-model/SKILL.md) | HIGH | Frame-based keyframes, origins, state machine |
| [ui-style-guide](.claude/skills/ui-style-guide/SKILL.md) | MEDIUM | Colors, buttons, spacing, components |
| [lint](.claude/skills/lint/SKILL.md) | MEDIUM | Build check for JS/JSX errors |

## Quick Reference

### Data Guards
```jsx
{selectedClip && <ClipEditor clip={selectedClip} />}
```

### MVC Structure
```
Screen (data fetching, hook initialization)
  └── Container (state logic, event handlers)
        └── View (presentational, props only)
```

### Keyframes
```javascript
keyframe = {
  frame: number,                    // Frame-based, not time
  origin: 'permanent' | 'user' | 'trim',
}
```

### State
- **Zustand stores**: Global state (`editorStore`, `exportStore`, etc.)
- **Screen-owned hooks**: Each screen initializes `useVideo`, `useCrop`, etc.
- **No prop drilling from App.jsx**: Screens are self-contained

## Real-time Updates
- **Prefer WebSockets over polling** for real-time status updates
- WebSocket connections are managed via service classes (e.g., `ExportWebSocketManager`)
- Polling should only be used as a fallback when WebSockets aren't feasible

## Don't
- Don't add console.logs in committed code
- Don't fetch data in View components
- Don't render components without data guards
- Don't use localStorage (all persistence via SQLite + R2)
- Don't use time in seconds for keyframes (use frame numbers)
- Don't use polling when WebSockets are available
