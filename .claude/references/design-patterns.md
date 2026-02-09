# Design Patterns Reference

Gang of Four patterns relevant to React + FastAPI projects.

## Quick Reference

| Pattern | Category | Use Case in This Project |
|---------|----------|-------------------------|
| **Strategy** | Behavioral | Swappable algorithms (local vs cloud, export types) |
| **Observer** | Behavioral | State subscriptions, event handling |
| **Factory** | Creational | Creating different component/handler types |
| **Singleton** | Creational | Zustand stores, service instances |
| **Adapter** | Structural | Wrapping external APIs, libraries |
| **Facade** | Structural | Simplifying complex subsystems |
| **Composite** | Structural | Component trees, nested regions |
| **Decorator** | Structural | HOCs, middleware |
| **Command** | Behavioral | Action dispatching, undo/redo |
| **State** | Behavioral | State machines, mode switching |

---

## Behavioral Patterns

### Strategy Pattern
**Use When**: Algorithm can vary independently from clients using it.

**This Project**: Local vs Cloud processing, export types.

```javascript
// BAD: Branching on type everywhere
async function processExport(mode) {
  if (mode === 'local') {
    // 50 lines of local processing
  } else if (mode === 'cloud') {
    // 50 lines of cloud processing
  }
}

// GOOD: Strategy pattern
const exportStrategies = {
  local: {
    async process(job) {
      return await localProcessor.run(job);
    }
  },
  cloud: {
    async process(job) {
      return await modalClient.run(job);
    }
  }
};

async function processExport(mode, job) {
  return await exportStrategies[mode].process(job);
}
```

**Backend Example** (modal_client.py):
```python
# Strategy selection happens once, internally
async def call_modal_framing_ai(job_id, ...):
    if modal_enabled():
        return await _cloud_framing(job_id, ...)
    else:
        return await _local_framing(job_id, ...)

# Callers don't know or care which strategy
result = await call_modal_framing_ai(job_id, ...)
```

### Observer Pattern
**Use When**: Objects need to be notified of state changes.

**This Project**: Zustand subscriptions, WebSocket events.

```javascript
// Zustand implements Observer internally
const useExportStore = create((set) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),
}));

// Components automatically re-render on changes
function ExportStatus() {
  const status = useExportStore((state) => state.status);
  return <div>{status}</div>;  // Re-renders when status changes
}

// Manual subscription for side effects
useEffect(() => {
  const unsubscribe = useExportStore.subscribe(
    (state) => state.status,
    (status) => {
      if (status === 'complete') showNotification();
    }
  );
  return unsubscribe;
}, []);
```

**WebSocket Observer**:
```javascript
// WebSocket events follow Observer pattern
websocket.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);
  eventHandlers[type]?.(payload);  // Notify appropriate handler
};
```

### Command Pattern
**Use When**: Need to parameterize actions, queue them, or support undo.

**This Project**: Gesture-based sync, action dispatching.

```javascript
// BAD: Direct mutations
function handleCropChange(x, y, width, height) {
  clip.x = x;
  clip.y = y;
  // How to undo? How to sync?
}

// GOOD: Command pattern
const commands = {
  ADD_CROP_KEYFRAME: (state, { frame, x, y, width, height }) => ({
    ...state,
    keyframes: [...state.keyframes, { frame, x, y, width, height }]
  }),
  REMOVE_KEYFRAME: (state, { frame }) => ({
    ...state,
    keyframes: state.keyframes.filter(k => k.frame !== frame)
  }),
};

function dispatch(action) {
  const newState = commands[action.type](state, action.payload);
  setState(newState);
  syncToBackend(action);  // Commands are serializable
}
```

**Backend Gesture-Based Sync**:
```python
# Commands sent from frontend
POST /api/clips/{id}/actions
{
  "action": "add_crop_keyframe",
  "data": { "frame": 100, "x": 50, "y": 50 }
}

# Backend applies command
def apply_action(clip, action):
    handlers = {
        "add_crop_keyframe": add_keyframe,
        "remove_keyframe": remove_keyframe,
    }
    return handlers[action["action"]](clip, action["data"])
```

### State Pattern
**Use When**: Object behavior changes based on internal state.

**This Project**: Export phases, editor modes.

```javascript
// BAD: Conditionals everywhere
function ExportButton({ phase }) {
  if (phase === 'idle') return <button>Export</button>;
  if (phase === 'uploading') return <button disabled>Uploading...</button>;
  if (phase === 'processing') return <button disabled>Processing...</button>;
  if (phase === 'complete') return <button>Download</button>;
}

// GOOD: State pattern
const phaseStates = {
  idle: {
    label: 'Export',
    disabled: false,
    action: startExport,
  },
  uploading: {
    label: 'Uploading...',
    disabled: true,
    action: null,
  },
  processing: {
    label: 'Processing...',
    disabled: true,
    action: null,
  },
  complete: {
    label: 'Download',
    disabled: false,
    action: downloadResult,
  },
};

function ExportButton({ phase }) {
  const state = phaseStates[phase];
  return (
    <button disabled={state.disabled} onClick={state.action}>
      {state.label}
    </button>
  );
}
```

---

## Creational Patterns

### Factory Pattern
**Use When**: Creation logic is complex or type-dependent.

**This Project**: Creating mode-specific handlers, export processors.

```javascript
// Factory for mode-specific hooks
function createModeHook(mode) {
  const hooks = {
    annotate: useAnnotateMode,
    framing: useFramingMode,
    overlay: useOverlayMode,
  };
  return hooks[mode];
}

// Usage
function ModeScreen({ mode }) {
  const useModeState = createModeHook(mode);
  const state = useModeState();
  return <ModeContainer state={state} />;
}
```

**Backend Factory**:
```python
def create_export_processor(export_type: str) -> ExportProcessor:
    processors = {
        "framing": FramingExportProcessor,
        "overlay": OverlayExportProcessor,
        "annotate": AnnotateExportProcessor,
    }
    return processors[export_type]()
```

### Singleton Pattern
**Use When**: Exactly one instance should exist globally.

**This Project**: Zustand stores, API clients.

```javascript
// Zustand store is a singleton
const useEditorStore = create((set) => ({
  mode: 'annotate',
  setMode: (mode) => set({ mode }),
}));

// Same instance everywhere
function ComponentA() {
  const mode = useEditorStore((s) => s.mode);
}
function ComponentB() {
  const setMode = useEditorStore((s) => s.setMode);
}
```

**Backend Singleton**:
```python
# Module-level singleton
_r2_client = None

def get_r2_client():
    global _r2_client
    if _r2_client is None:
        _r2_client = R2Client(...)
    return _r2_client
```

---

## Structural Patterns

### Adapter Pattern
**Use When**: Need to use existing class with incompatible interface.

**This Project**: Wrapping browser APIs, external libraries.

```javascript
// Adapter for different video player APIs
class VideoPlayerAdapter {
  constructor(playerType) {
    this.player = playerType === 'native'
      ? new NativeVideoPlayer()
      : new CustomVideoPlayer();
  }

  play() { this.player.play(); }
  pause() { this.player.pause(); }
  seek(time) { this.player.setCurrentTime(time); }
  getCurrentTime() { return this.player.currentTime; }
}

// Usage - consistent interface regardless of player type
const player = new VideoPlayerAdapter('native');
player.seek(10.5);
```

### Facade Pattern
**Use When**: Need simple interface to complex subsystem.

**This Project**: Export helpers, API clients.

```javascript
// BAD: Complex subsystem exposed
async function exportVideo() {
  const job = await createJob();
  await uploadFile(job.id, file);
  await startProcessing(job.id);
  const status = await pollStatus(job.id);
  const result = await downloadResult(job.id);
  await cleanup(job.id);
  return result;
}

// GOOD: Facade hides complexity
async function exportVideo(file, options) {
  return await exportFacade.run(file, options);
}

// Facade internally handles all steps
class ExportFacade {
  async run(file, options) {
    const job = await this.createJob();
    try {
      await this.upload(job, file);
      await this.process(job, options);
      return await this.download(job);
    } finally {
      await this.cleanup(job);
    }
  }
}
```

**Backend export_helpers.py is a Facade**:
```python
# Simple interface
await send_progress(export_id, 50, 100, 'processing', 'Halfway...')

# Hides: WebSocket lookup, message formatting, error handling
```

### Composite Pattern
**Use When**: Tree structures where leaf and composite are treated uniformly.

**This Project**: Component trees, nested timeline regions.

```jsx
// Timeline can contain regions, regions can contain keyframes
function Timeline({ children }) {
  return <div className="timeline">{children}</div>;
}

function Region({ region, children }) {
  return (
    <div className="region">
      <RegionBar region={region} />
      {children}  {/* Keyframes or nested regions */}
    </div>
  );
}

function Keyframe({ keyframe }) {
  return <div className="keyframe" style={{ left: keyframe.time }} />;
}

// Uniform rendering
<Timeline>
  <Region region={region1}>
    <Keyframe keyframe={kf1} />
    <Keyframe keyframe={kf2} />
  </Region>
  <Region region={region2}>
    <Keyframe keyframe={kf3} />
  </Region>
</Timeline>
```

### Decorator Pattern
**Use When**: Add responsibilities dynamically without subclassing.

**This Project**: HOCs, middleware, wrappers.

```jsx
// HOC Decorator - adds loading state
function withLoading(Component) {
  return function WithLoading({ isLoading, ...props }) {
    if (isLoading) return <Spinner />;
    return <Component {...props} />;
  };
}

const VideoPlayerWithLoading = withLoading(VideoPlayer);
```

**Backend Middleware Decorator**:
```python
# FastAPI dependency injection is decorator pattern
async def require_auth(request: Request):
    token = request.headers.get("Authorization")
    if not validate_token(token):
        raise HTTPException(401)
    return get_user(token)

@router.get("/protected")
async def protected_route(user: User = Depends(require_auth)):
    return {"user": user.id}
```

---

## When to Apply

| Situation | Pattern |
|-----------|---------|
| Multiple algorithms, same interface | Strategy |
| React to state changes | Observer |
| Parameterize/queue/undo actions | Command |
| Behavior varies by state | State |
| Complex object creation | Factory |
| Global shared instance | Singleton |
| Incompatible interface | Adapter |
| Simplify complex subsystem | Facade |
| Tree/nested structures | Composite |
| Add behavior without subclassing | Decorator |
