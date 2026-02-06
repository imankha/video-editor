# mvc-view-no-hooks

**Priority:** CRITICAL
**Category:** View Layer

## Rule
View components never use React hooks. They are pure functions that render based on props.

## Rationale
Views with hooks become:
1. Harder to test (need to mock hook behavior)
2. Harder to reuse (tied to specific data sources)
3. Harder to reason about (mixing presentation and logic)
4. Prone to unexpected re-renders

## Incorrect Example

```jsx
// ClipCardView.jsx
function ClipCardView({ clipId }) {
  // BAD: View uses hooks
  const { clip } = useClipStore(state => ({
    clip: state.clips.find(c => c.id === clipId)
  }));

  const [isHovered, setIsHovered] = useState(false);

  const handleClick = useCallback(() => {
    // Some logic
  }, [clip]);

  if (!clip) return null;

  return (
    <div
      className={`clip-card ${isHovered ? 'hovered' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      <img src={clip.thumbnail} alt={clip.name} />
      <span>{clip.name}</span>
    </div>
  );
}
```

**Why this is wrong:**
- View fetches its own data via `useClipStore`
- Local state (`isHovered`) should be in container if it affects logic
- `useCallback` is a hook, making this not a pure view
- The null check indicates data isn't guaranteed

## Correct Example

```jsx
// ClipCardView.jsx
function ClipCardView({
  thumbnail,
  name,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onClick
}) {
  // GOOD: Pure presentation, no hooks
  return (
    <div
      className={`clip-card ${isHovered ? 'hovered' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <img src={thumbnail} alt={name} />
      <span>{name}</span>
    </div>
  );
}

// ClipCardContainer.jsx
function ClipCardContainer({ clip, onSelect }) {
  // Container handles state and handlers
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);
  const handleClick = useCallback(() => onSelect(clip.id), [clip.id, onSelect]);

  return (
    <ClipCardView
      thumbnail={clip.thumbnail}
      name={clip.name}
      isHovered={isHovered}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    />
  );
}
```

## Additional Context

### What Views CAN do:
- Render JSX based on props
- Apply CSS classes based on prop values
- Map over prop arrays to render lists
- Use ternary operators for conditional rendering

### What Views CANNOT do:
- Use `useState`, `useEffect`, `useCallback`, `useMemo`
- Call `useStore`, `useContext`, or custom hooks
- Fetch data
- Handle complex event logic (simple `onClick` passthrough is OK)

### Exception: CSS-only state
For purely visual state (like hover) that doesn't affect any logic, you may use CSS `:hover` instead of React state:

```jsx
function ClipCardView({ thumbnail, name, onClick }) {
  return (
    <div className="clip-card hover:bg-gray-100" onClick={onClick}>
      <img src={thumbnail} alt={name} />
      <span>{name}</span>
    </div>
  );
}
```
