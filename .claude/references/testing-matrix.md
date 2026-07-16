# Testing Matrix

Guide for determining appropriate test coverage based on change type.

## Quick Reference

| Change Type | Unit | Integration | E2E | Mobile Audit | Manual |
|-------------|:----:|:-----------:|:---:|:------------:|:------:|
| UI only (styling) | - | - | - | ✅ if layout | ✅ Visual |
| UI with interaction | - | - | ✅ | ✅ | ✅ |
| State logic (hook) | ✅ | - | - | - | - |
| State + UI | ✅ | - | ✅ | ✅ if layout | ✅ |
| API endpoint | ✅ | ✅ | - | - | - |
| Full feature | ✅ | ✅ | ✅ | ✅ | ✅ |
| Refactoring | ✅ Existing | ✅ Existing | ✅ Existing | ✅ if layout | - |
| Viewport-unit (vh/dvh/h-screen) | - | - | ✅ | ✅ | ✅ **Real device** |

**Mobile Audit** = the T4930 screen-usability matrix (`e2e/screen-usability.spec.js`):
every primary action reachable + clickable, no horizontal overflow, no dead scroll
trap, run across iPhone / iPhone SE / Pixel 7 / iPad / desktop (phones in portrait +
landscape). **Any UI/layout change must be covered by it** — a layout that breaks below
the fold on a phone (the T4880 class) is invisible to desktop E2E. See
[Mobile Viewport Usability](#mobile-viewport-usability-t4930) below.

> **Real-device check required for viewport-unit changes.** Playwright emulation does
> NOT reproduce iOS Safari's dynamic browser toolbar (the `100vh`-vs-`100dvh` clipping
> that caused T4880). Any change touching viewport units (`vh`/`dvh`/`h-screen`/
> `h-dvh`/fullscreen layout) must ALSO be checked on a real iPhone before it is called
> done — the emulator will pass a layout that clips on the device. The
> `scripts/check-viewport-units.mjs` gate bans `h-screen`/`100vh` in the app tree to
> block the emulator-invisible form at the source, but it is not a substitute for the
> device check.

---

## By Layer

### Frontend - UI Only (No State)

**Examples**: Styling changes, layout adjustments, static text

**Testing**:
- ❌ Unit tests - nothing to unit test
- ❌ Integration - no integration points
- ⚠️ E2E - only if critical user path
- ✅ Manual - visual verification

```bash
# Just verify visually
npm run dev
# Check the affected page
```

### Frontend - UI with Interaction

**Examples**: Button clicks, toggles, form inputs (using existing state)

**Testing**:
- ❌ Unit tests - UI behavior tested via E2E
- ❌ Integration - no new integration points
- ✅ E2E - verify interaction works
- ✅ Manual - verify feel/UX

```javascript
// E2E test example
test('clicking layer icon toggles player boxes', async ({ page }) => {
  await page.goto('/overlay');
  await page.click('[data-testid="detection-layer-icon"]');
  await expect(page.locator('.player-box')).toBeHidden();
});
```

### Frontend - State Logic (Hooks/Stores)

**Examples**: New hook, store changes, computed values

**Testing**:
- ✅ Unit tests - test the logic in isolation
- ❌ Integration - unless API involved
- ⚠️ E2E - only if user-facing
- ❌ Manual - logic is invisible

```javascript
// Unit test example
describe('useToggle', () => {
  it('toggles value on call', () => {
    const { result } = renderHook(() => useToggle(false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
  });
});
```

### Frontend - State + UI Combined

**Examples**: New feature with state management and UI

**Testing**:
- ✅ Unit tests - for state logic
- ⚠️ Integration - if crosses boundaries
- ✅ E2E - verify full user flow
- ✅ Manual - verify UX

```javascript
// Unit: test the hook
describe('usePlayerBoxes', () => { ... });

// E2E: test the feature
test('user can toggle player boxes via layer icon', async ({ page }) => {
  // Setup
  await loadVideoWithDetections(page);

  // Action
  await page.click('[data-testid="detection-layer-icon"]');

  // Verify
  await expect(page.locator('.player-box')).toBeHidden();
});
```

### Mobile Viewport Usability (T4930)

**Examples**: Any UI/layout change — a new screen, a repositioned control, a new modal,
a header/sidebar/timeline restructure, a fullscreen mode, a `vh`/`dvh` change.

**Why it exists**: T4880 (mobile Framing/Overlay controls unreachable below the timeline)
shipped to production and was found by a user, not by us, because the E2E suite ran a
single Desktop-Chrome project and asserted *functionality*, never *usability*. Nothing
ran at a mobile viewport.

**What it asserts** (behavioral, not pixel snapshots), per screen, per viewport:
1. Every primary action is reachable (scrolled into view) + clickable (not covered/clipped).
2. No horizontal overflow.
3. No dead scroll trap (content clipped below a non-scrolling shell — the T4880 shape).

**Testing**:
- ✅ Add/extend the screen's manifest in `e2e/manifests/screenManifests.js` (declarative
  list of primary actions) — do NOT copy-paste a whole new test.
- ✅ The audit runs across `iphone`, `iphone-se`, `android`, `tablet`, `chromium` projects
  (phones portrait + landscape) via `e2e/screen-usability.spec.js`.
- ✅ **Real device** for any viewport-unit change (see the callout above) — the emulator
  cannot reproduce the iOS toolbar.
- The `check-viewport-units.mjs` gate (wired into the lint hook + branch CI) bans new
  `h-screen`/`100vh` in `src/frontend/src`.

```bash
# Run the whole matrix (starts the stack in a container):
bash scripts/dev-verify.sh e2e/screen-usability.spec.js
# Or a single viewport project:
cd src/frontend && npx playwright test screen-usability.spec.js --project=iphone
```

### Backend - API Endpoint

**Examples**: New route, endpoint modification

**Testing**:
- ✅ Unit tests - handler logic
- ✅ Integration - full request/response
- ❌ E2E - unless user-facing feature
- ❌ Manual - unless debugging

```python
# Unit test
def test_process_export_validates_input():
    with pytest.raises(ValidationError):
        process_export(invalid_input)

# Integration test
async def test_export_endpoint_returns_job_id():
    response = await client.post("/api/export", json=valid_payload)
    assert response.status_code == 200
    assert "job_id" in response.json()
```

### Full Feature (Frontend + Backend + State)

**Examples**: New user-facing feature end-to-end

**Testing**:
- ✅ Unit tests - logic on both ends
- ✅ Integration - API contracts
- ✅ E2E - critical user paths
- ✅ Manual - UX and edge cases

```
Coverage pyramid:
    /\
   /  \  E2E (few)
  /----\
 /      \ Integration (some)
/--------\
    Unit (many)
```

### Refactoring

**Examples**: Code restructuring, extracting utilities

**Testing**:
- ✅ Existing tests should still pass
- ⚠️ Add tests if coverage was missing
- ❌ Don't add new tests for same behavior

```bash
# Run existing tests - they should all pass
npm test
npm run test:e2e
cd src/backend && python run_tests.py
```

---

## Test File Locations

| Type | Location | Command |
|------|----------|---------|
| Frontend Unit | `src/frontend/src/**/*.test.{js,jsx}` | `npm test` |
| Frontend E2E | `src/frontend/tests/**/*.spec.js` | `npm run test:e2e` |
| Backend Unit | `src/backend/tests/unit/**/*.py` | `pytest tests/unit/` |
| Backend Integration | `src/backend/tests/integration/**/*.py` | `pytest tests/integration/` |

---

## Coverage Guidelines

### Minimum Coverage by Complexity

| Task Complexity | Unit | Integration | E2E |
|-----------------|------|-------------|-----|
| Trivial | - | - | - |
| Simple | If logic added | - | If UI changed |
| Standard | Required | If API | Required |
| Complex | Required | Required | Required |

### What to Test

**Always test**:
- New business logic
- State mutations
- API contracts
- Critical user paths

**Skip testing**:
- Pure UI styling
- Framework behavior (React, FastAPI)
- Third-party library internals
- One-off scripts

### Test Quality Checklist

- [ ] Tests are independent (no shared state)
- [ ] Tests are deterministic (no flakiness)
- [ ] Tests are fast (mock external services)
- [ ] Tests document behavior (good names)
- [ ] Tests fail for the right reason

---

## Examples by Feature Area

### Annotate Mode
| Change | Tests Needed |
|--------|-------------|
| Clip selection UI | E2E, Manual |
| Segment extraction logic | Unit |
| Clip save to backend | Unit, Integration |

### Framing Mode
| Change | Tests Needed |
|--------|-------------|
| Crop overlay UI | E2E, Manual |
| Keyframe interpolation | Unit |
| Export processing | Unit, Integration, E2E |

### Overlay Mode
| Change | Tests Needed |
|--------|-------------|
| Highlight region UI | E2E, Manual |
| Player detection overlay | E2E, Manual |
| Effect rendering | Unit (logic), Manual (visual) |

### Gallery Mode
| Change | Tests Needed |
|--------|-------------|
| Download button | E2E |
| File listing | Integration |
| Presigned URL generation | Unit, Integration |
