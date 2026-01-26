# Frontend Guidelines

## Stack
React 18 + Vite + Zustand + Tailwind

## Testing
```bash
npm test                    # Unit tests (Vitest)
npm run test:e2e           # E2E tests (Playwright) - start servers first!
npm run test:e2e -- --ui   # E2E with visual UI
```

## Architecture: Data Always Ready + MVC

### Screen → Container → View Pattern
```
Screen (data fetching, hook initialization)
  └── Container (state logic, event handlers)
        └── View (presentational, props only)
```

**Screens** own hooks and ensure data is loaded before rendering children.
**Containers** receive data as props, manage derived state and handlers.
**Views** are pure presentation - no hooks, no data fetching.

### Data Always Ready
Components should never render loading states internally. Parent ensures data exists:
```jsx
// Good - parent guards
{selectedClip && <ClipEditor clip={selectedClip} />}

// Bad - child checks
function ClipEditor({ clip }) {
  if (!clip) return <Loading />;  // Don't do this
}
```

## State Management
- **Zustand stores**: Global state (`editorStore`, `exportStore`, etc.)
- **Screen-owned hooks**: Each screen initializes `useVideo`, `useCrop`, etc.
- **No prop drilling from App.jsx**: Screens are self-contained

## Keyframes
```javascript
keyframe = {
  frame: number,                    // Frame-based, not time
  origin: 'permanent' | 'user' | 'trim',
  // + mode-specific data (x, y, width, height for crop)
}
```

## Don't
- Don't add console.logs in committed code
- Don't fetch data in View components
- Don't render components without data guards
