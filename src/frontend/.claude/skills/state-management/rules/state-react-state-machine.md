# state-react-state-machine

Use state machines for async flows instead of refs and timeouts.

## Rule

When a component has async operations that affect UI behavior (loading, saving, syncing), model the flow as an explicit state machine using React state.

## Why

1. **Refs don't trigger re-renders** - Components won't update when ref values change
2. **Timeouts are arbitrary** - Magic numbers like `100ms` are fragile and untestable
3. **Hidden state is invisible** - Refs don't appear in React DevTools
4. **Effects won't re-run** - useEffect dependencies can't include ref values

## Pattern

```javascript
// Define explicit states
const [syncState, setSyncState] = useState('idle');
// States: 'idle' | 'loading' | 'ready' | 'error'

// Async operation with state transitions
useEffect(() => {
  if (shouldLoad && syncState === 'idle') {
    setSyncState('loading');

    fetchData()
      .then(data => {
        processData(data);
        setSyncState('ready');
      })
      .catch(() => setSyncState('error'));
  }
}, [shouldLoad, syncState]);

// Behavior is now reactive
const canPerformAction = syncState === 'ready';

// Components re-render when state changes
return canPerformAction ? <ActionButton /> : <LoadingSpinner />;
```

## Anti-Pattern

```javascript
// BAD: Ref + timeout
const isReadyRef = useRef(false);

useEffect(() => {
  fetchData().then(() => {
    isReadyRef.current = true;
    setTimeout(() => { /* magic cleanup */ }, 100);
  });
}, []);

// Won't trigger re-render when ref changes
const canAct = isReadyRef.current;
```

## State Transitions

Document your state machine transitions:

```
idle -> loading (on: fetch triggered)
loading -> ready (on: fetch success)
loading -> error (on: fetch failure)
ready -> idle (on: project change)
error -> loading (on: retry)
```

## Testing

State machines are easy to test:

```javascript
it('transitions from loading to ready on success', async () => {
  render(<Component />);
  expect(screen.getByText('Loading')).toBeInTheDocument();

  await waitFor(() => {
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });
});
```
