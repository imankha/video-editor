# Remove Unused `updateClipProgress` Frontend Function

**Priority**: 4
**Smell**: Dead Code / Speculative Generality
**Pattern**: Remove Dead Code

---

## Current State

The `useProjectClips.js` hook exports an `updateClipProgress()` function that calls the backend to update a clip's progress field.

---

## Problem

- Frontend never needs to set progress directly
- Progress is set by backend during export (in `save_working_video()`)
- Function exists but has no callers
- Creates confusion about data flow

---

## Code Location

### Definition

**File**: `src/frontend/src/hooks/useProjectClips.js`
**Lines**: 180-206

```javascript
const updateClipProgress = useCallback(async (clipId, progress) => {
  if (!projectId) {
    console.error('[useProjectClips] updateClipProgress: No project selected');
    return false;
  }

  try {
    const response = await fetch(
      `${API_BASE}/clips/projects/${projectId}/clips/${clipId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress })
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to update clip progress: ${response.status}`);
    }

    // Update local state
    setClips(prev => prev.map(clip =>
      clip.id === clipId ? { ...clip, progress } : clip
    ));

    return true;
  } catch (err) {
    console.error('[useProjectClips] updateClipProgress error:', err);
    return false;
  }
}, [projectId]);
```

### Export

**File**: `src/frontend/src/hooks/useProjectClips.js`
**Line**: 307

```javascript
return {
  // ...other exports
  updateClipProgress,
  // ...
};
```

---

## Verification Commands

Run these commands to verify no callers exist:

```bash
# Check for any usage of updateClipProgress outside definition file
grep -r "updateClipProgress" src/frontend --include="*.js" --include="*.jsx" | grep -v "useProjectClips.js"

# Check for destructuring that includes updateClipProgress
grep -r "updateClipProgress" src/frontend --include="*.js" --include="*.jsx"
```

**Expected output**: Only matches in `useProjectClips.js` (definition and export)

If any matches found outside the definition file, those call sites need to be analyzed before removal.

---

## Proposed Change

1. **Verify no callers** using grep commands above
2. **Remove the function** (lines 180-206)
3. **Remove from return object** (line 307)
4. **Run tests** to ensure nothing breaks

---

## Related Backend Code

The backend endpoint that this function would call:

**File**: `src/backend/app/routers/clips.py`
**Lines**: 456-458

```python
if update.progress is not None:
    update_fields.append("progress = ?")
    params.append(update.progress)
```

This backend code can remain (it's part of generic update), but the frontend function is unnecessary since progress is only set by the backend during export.

---

## Tests to Write BEFORE Refactor

For dead code removal, the main "test" is verification that the code is not called. However, we should also test that the remaining clip operations still work.

### Test File: `src/frontend/src/hooks/__tests__/useProjectClips.test.js`

```javascript
/**
 * Tests for useProjectClips hook.
 * Run BEFORE removing updateClipProgress to verify other functions work.
 * Run AFTER to verify removal didn't break anything.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProjectClips } from '../useProjectClips';

// Mock fetch
global.fetch = jest.fn();

describe('useProjectClips', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('loadProjectClips', () => {
    it('should load clips for a project', async () => {
      const mockClips = [
        { id: 1, fileName: 'clip1.mp4', version: 1 },
        { id: 2, fileName: 'clip2.mp4', version: 1 }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ clips: mockClips })
      });

      const { result } = renderHook(() => useProjectClips());

      await act(async () => {
        await result.current.loadProjectClips(
          mockClips,
          (id) => `http://localhost/clips/${id}`,
          async () => ({ duration: 10, framerate: 30 }),
          '9:16'
        );
      });

      expect(result.current.clips.length).toBe(2);
    });
  });

  describe('updateClip', () => {
    it('should update clip data via API', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      const { result } = renderHook(() => useProjectClips());

      // Set project ID first
      act(() => {
        result.current.setProjectId(1);
      });

      await act(async () => {
        const success = await result.current.updateClip(1, {
          crop_data: '[{"frame":0}]'
        });
        expect(success).toBe(true);
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/clips/1'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('saveCurrentClipState', () => {
    it('should save crop and segment data for current clip', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      const { result } = renderHook(() => useProjectClips());

      act(() => {
        result.current.setProjectId(1);
        // Set up clips with current selection
      });

      // Test implementation depends on hook internals
    });
  });

  // BEFORE REMOVAL: This test documents that updateClipProgress exists
  // AFTER REMOVAL: Remove this test
  describe('updateClipProgress (DEAD CODE - TO BE REMOVED)', () => {
    it('should exist in hook exports (before removal)', () => {
      const { result } = renderHook(() => useProjectClips());

      // BEFORE: This should pass
      // AFTER: This test should be removed along with the function
      expect(result.current.updateClipProgress).toBeDefined();
    });
  });
});
```

### Verification Test (Shell Script)

Create `src/frontend/scripts/verify-no-dead-code-usage.sh`:

```bash
#!/bin/bash
# Verify updateClipProgress is not used anywhere except its definition

echo "Checking for updateClipProgress usage..."

USAGE_COUNT=$(grep -r "updateClipProgress" src/frontend --include="*.js" --include="*.jsx" | grep -v "useProjectClips.js" | grep -v "__tests__" | wc -l)

if [ "$USAGE_COUNT" -gt 0 ]; then
  echo "ERROR: Found $USAGE_COUNT usages of updateClipProgress outside definition:"
  grep -r "updateClipProgress" src/frontend --include="*.js" --include="*.jsx" | grep -v "useProjectClips.js" | grep -v "__tests__"
  exit 1
else
  echo "SUCCESS: No external usages found. Safe to remove."
  exit 0
fi
```

---

## Test Execution Plan

### Phase 1: Before Refactor
1. Run verification script to confirm no usages
2. Write/run `useProjectClips.test.js` to verify other hook functions work
3. Run: `npm test -- --testPathPattern=useProjectClips`
4. All tests must PASS
5. Commit: "Add tests for useProjectClips before dead code removal"

### Phase 2: Remove Dead Code
1. Delete `updateClipProgress` function (lines 180-206)
2. Remove from return object (line 307)
3. Remove the test for `updateClipProgress` existence

### Phase 3: After Refactor
1. Run: `npm test`
2. Run: `npm run build` (verify no TypeScript/lint errors)
3. Run verification script again to confirm no broken imports
4. Manual test: Open app, select project, edit clip, verify no console errors
5. Commit: "Remove unused updateClipProgress function"

---

## Manual Verification Checklist

- [ ] Grep confirms no callers outside definition file
- [ ] App loads without errors after removal
- [ ] Can select and edit clips
- [ ] Can export from framing mode (progress set by backend)
- [ ] No console errors related to updateClipProgress

---

## Benefits

- Removes dead code
- Clarifies that progress is server-controlled
- Reduces hook complexity
- Prevents accidental misuse
