# Manual Test Scripts for Modified Code

These tests exercise the code modified in this branch:
1. **WebSocket progress** - Multiple client support, Vite proxy
2. **Duration mismatch fix** - OpenCV frame extraction workaround
3. **Phase 2 refactoring** - useOverlayState and useAnnotateState hooks

---

## Prerequisites

Start both servers in separate terminals:

```bash
# Terminal 1: Backend
cd src/backend
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend
cd src/frontend
npm run dev
```

Open browser to http://localhost:5173

---

## Test 1: Overlay State Hook (useOverlayState)

**Tests:** State consolidation, video loading, effect type changes

### Steps:
1. **Upload a video in Framing mode**
   - Click "Upload Video" or drag a video file
   - Verify video loads and plays

2. **Add crop keyframes**
   - Click on the crop layer
   - Resize the crop rectangle
   - Move playhead and add another keyframe

3. **Export to Overlay mode**
   - Click "Export to Overlay" button
   - Watch progress bar (tests WebSocket)
   - Verify video appears in Overlay mode

4. **Test effect type toggle**
   - In Overlay mode, change effect type dropdown
   - Verify highlight preview changes

5. **Add highlight region**
   - Click on timeline to add highlight region
   - Drag to resize
   - Add keyframes within region

### Expected:
- No console errors about undefined state
- State persists when switching tabs/modes
- Effect type changes reflect immediately

---

## Test 2: Annotate State Hook (useAnnotateState)

**Tests:** Game loading, clip creation, playback speed, fullscreen

### Steps:
1. **Switch to Annotate mode**
   - Click "Annotate" in mode switcher

2. **Upload a game video**
   - Click "Upload Game" or use file picker
   - Verify video loads

3. **Create clip regions**
   - Play video to desired point
   - Pause (or click "Add Clip")
   - Repeat to create 3-5 clips

4. **Test playback speed**
   - Click speed button (1x -> 1.5x -> 2x -> 0.5x)
   - Verify playback speed changes

5. **Test fullscreen**
   - Press 'F' or click fullscreen button
   - Pause in fullscreen (should show clip overlay)
   - Exit fullscreen

6. **Test layer navigation**
   - Use arrow keys to navigate between clips
   - Verify selection changes

### Expected:
- Playback speed changes without errors
- Fullscreen toggle works
- Clip regions persist
- Layer selection updates

---

## Test 3: WebSocket Progress (Multi-Client)

**Tests:** Progress bar updates, multiple connections

### Steps:
1. **Open two browser tabs** to http://localhost:5173

2. **In Tab 1:** Upload and prepare a video for export

3. **In Tab 2:** Navigate to same project (if using projects)

4. **Start export in Tab 1**
   - Click export button
   - Watch progress bar in BOTH tabs

5. **Check backend logs**
   ```
   [WS] WebSocket CONNECTED for export_id: xxx (now 2 clients)
   [WS] Sent progress to 2 client(s) for xxx: 25.0%
   ```

### Expected:
- Both tabs show progress updates
- Progress bar moves smoothly (not stuck at 10%)
- Backend logs show "2 clients"

---

## Test 4: Duration Preservation (Framing Export)

**Tests:** Frame count accuracy, no truncation

### Steps:
1. **Get source video duration**
   - Upload video
   - Note the duration shown in UI (e.g., 11.243s)

2. **Export from Framing**
   - Add some crop edits
   - Click export
   - Wait for completion

3. **Check exported video duration**
   - Download the exported video
   - Check duration matches source (within 0.1s)

4. **Check backend logs for frame count**
   ```
   [Framing Export] Final frame count: 309, duration: 11.243000s
   ```

### Expected:
- Exported duration matches source
- No "frames failed processing" errors
- Logs show consistent frame counts

---

## Test 5: Mode Switching with Unsaved Changes

**Tests:** State preservation, confirmation dialogs

### Steps:
1. **Load video in Framing mode**
   - Make crop edits

2. **Switch to Overlay mode**
   - If changes exist, confirmation dialog should appear
   - Click "Continue" to proceed

3. **Make overlay edits**
   - Add highlight regions

4. **Switch back to Framing**
   - Verify framing edits still exist

5. **Switch to Annotate**
   - Load a different video
   - Create clips

6. **Switch back to Overlay**
   - Verify overlay video and regions persist

### Expected:
- Mode-specific state is preserved
- Switching modes doesn't lose edits
- Confirmation dialogs appear when appropriate

---

## Test 6: Stress Test - Rapid Mode Switching

**Tests:** State stability under rapid changes

### Script (run in browser console):
```javascript
// Stress test mode switching
async function stressTest() {
  const modes = ['framing', 'overlay', 'annotate'];
  for (let i = 0; i < 20; i++) {
    const mode = modes[i % 3];
    console.log(`Switching to ${mode}...`);
    // Simulate mode switch by clicking mode buttons
    document.querySelector(`[data-mode="${mode}"]`)?.click();
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Stress test complete');
}
stressTest();
```

### Expected:
- No crashes or frozen UI
- Console shows no React errors
- State remains consistent

---

## Test 7: API Endpoint Verification

**Tests:** Backend routes work correctly

### Run these curl commands:

```bash
# Test health check
curl http://localhost:8000/api/health

# Test projects list (creates tables if needed)
curl http://localhost:8000/api/projects

# Test games list
curl http://localhost:8000/api/games

# Test clips list
curl http://localhost:8000/api/clips

# Test WebSocket endpoint exists (will fail but shouldn't 404)
curl -I http://localhost:8000/ws/export/test123
```

### Expected:
- Health returns 200
- Empty lists return `[]`
- WebSocket endpoint returns upgrade required (not 404)

---

## Test 8: Overlay Export with Highlights

**Tests:** Full export pipeline with highlight regions

### Steps:
1. **Prepare video with highlights**
   - Load video in Framing mode
   - Export to Overlay mode
   - Add 2-3 highlight regions with keyframes

2. **Export final video**
   - Click "Export Final"
   - Watch progress bar

3. **Check backend logs**
   ```
   [Overlay Export] Processing highlight region 1/3
   [Overlay Export] Rendered 309 frames
   [Overlay Export] Final frame count: 309, duration: 11.243000s
   ```

4. **Verify output**
   - Download exported video
   - Check highlights are visible
   - Duration matches source

### Expected:
- Highlights render correctly
- Progress updates in real-time
- No frame drops or artifacts

---

## Automated API Test Script

Save as `test_api.py` and run with Python:

```python
import requests
import time

BASE = "http://localhost:8000"

def test_api():
    print("Testing API endpoints...")

    # Health check
    r = requests.get(f"{BASE}/api/health")
    assert r.status_code == 200, f"Health check failed: {r.status_code}"
    print("✓ Health check passed")

    # Projects
    r = requests.get(f"{BASE}/api/projects")
    assert r.status_code == 200, f"Projects failed: {r.status_code}"
    print(f"✓ Projects: {len(r.json())} found")

    # Games
    r = requests.get(f"{BASE}/api/games")
    assert r.status_code == 200, f"Games failed: {r.status_code}"
    print(f"✓ Games: {len(r.json())} found")

    # Clips
    r = requests.get(f"{BASE}/api/clips")
    assert r.status_code == 200, f"Clips failed: {r.status_code}"
    print(f"✓ Clips: {len(r.json())} found")

    print("\nAll API tests passed!")

if __name__ == "__main__":
    test_api()
```

---

## WebSocket Test Script

Save as `test_websocket.py`:

```python
import asyncio
import websockets
import json

async def test_websocket():
    uri = "ws://localhost:8000/ws/export/test-123"
    print(f"Connecting to {uri}...")

    try:
        async with websockets.connect(uri) as ws:
            print("✓ Connected!")

            # Send a ping
            await ws.send("ping")
            print("✓ Sent ping")

            # Wait for any response (with timeout)
            try:
                response = await asyncio.wait_for(ws.recv(), timeout=5.0)
                print(f"✓ Received: {response}")
            except asyncio.TimeoutError:
                print("○ No response (normal for progress endpoint)")

            print("\nWebSocket connection test passed!")

    except Exception as e:
        print(f"✗ Connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket())
```

---

## Quick Smoke Test Checklist

Run through this quickly to verify basic functionality:

- [ ] Frontend loads without console errors
- [ ] Can upload video in Framing mode
- [ ] Can switch to Overlay mode
- [ ] Can switch to Annotate mode
- [ ] Export progress bar moves (not stuck)
- [ ] No "undefined" errors in console
- [ ] Playback controls work
- [ ] Speed controls work in Annotate mode

---

## Common Issues to Watch For

1. **Progress bar stuck at 10%**
   - Check: Is Vite proxy configured? (`/ws` in vite.config.js)
   - Check: Backend logs show WebSocket connections?

2. **State undefined errors**
   - Check: Hooks destructured correctly in App.jsx?
   - Check: All state exported from useOverlayState/useAnnotateState?

3. **Export duration mismatch**
   - Check: Backend logs show "using minimum of ffprobe and opencv"?
   - Check: No "frames failed processing" errors?

4. **Mode switch loses state**
   - Check: Each mode uses its own hook instance?
   - Check: State not being reset on mode change?
