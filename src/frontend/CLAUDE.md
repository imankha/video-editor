# Frontend Guidelines

## Skills

| Skill | Priority | Description |
|-------|----------|-------------|
| [data-always-ready](.claude/skills/data-always-ready/SKILL.md) | CRITICAL | Parent guards data, children assume it exists |
| [mvc-pattern](.claude/skills/mvc-pattern/SKILL.md) | CRITICAL | Screen → Container → View separation |
| [state-management](.claude/skills/state-management/SKILL.md) | CRITICAL | Single store ownership, no duplicate state |
| [keyframe-data-model](.claude/skills/keyframe-data-model/SKILL.md) | HIGH | Frame-based keyframes, origins, state machine |
| [ui-style-guide](.claude/skills/ui-style-guide/SKILL.md) | MEDIUM | Colors, buttons, spacing, components |

---

## Quick Reference

### Data Guards
```jsx
// Parent guards, child renders
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
  // + mode-specific data (x, y, width, height for crop)
}
```

### State
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
