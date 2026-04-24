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
| [responsiveness](.claude/skills/responsiveness/SKILL.md) | MEDIUM | Mobile-first responsive patterns, Playwright testing workflow |
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

## Testing Auth Bypass (Dev/Staging Only)

When testing UI changes in the browser via Playwright MCP, bypass auth using the e2e test pattern:

```javascript
// 1. Set headers so backend accepts requests without a session cookie
await page.setExtraHTTPHeaders({
  'X-User-ID': 'manual-test-user',
  'X-Test-Mode': 'true',
});

// 2. Hit the test-login endpoint to get a session cookie
await page.evaluate(async () => {
  await fetch('/api/auth/test-login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
  });
});

// 3. Bypass the frontend auth gate
await page.evaluate(async () => {
  const { useAuthStore } = await import('/src/stores/authStore.js');
  useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
});

// 4. Reload to pick up authenticated state
await page.reload();
```

See `e2e/new-user-flow.spec.js` for the full pattern. The test-login endpoint creates an `e2e@test.local` user and is blocked in production.

## Don't
- Don't add console.logs in committed code
- Don't fetch data in View components
- Don't render components without data guards
- Don't use localStorage (all persistence via SQLite + R2)
- Don't use time in seconds for keyframes (use frame numbers)
- Don't use polling when WebSockets are available
- Don't hold backend API data in React useState (use Zustand stores)
- Don't transform API responses before storing (store raw, compute on read)
- Don't generate client-side IDs for backend entities (use backend IDs)
- Don't store derived boolean flags (isExtracted, isFailed) — compute via selectors
- Don't use reactive `useEffect` to persist state — no watching hook state to write to store/backend (causes fixup data corruption). Use gesture-based API calls instead.
- Don't save state in useEffect cleanup functions — React may have already cleared the state
- Don't send full hook state (all keyframes/segments) in gesture handlers — use surgical API calls that send only the changed data
- Don't store trimRange in timing_data — it lives only in segments_data
