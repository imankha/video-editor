# Testing Matrix

Guide for determining appropriate test coverage based on change type.

## Quick Reference

| Change Type | Unit | Integration | E2E | Manual |
|-------------|:----:|:-----------:|:---:|:------:|
| UI only (styling) | - | - | - | ✅ Visual |
| UI with interaction | - | - | ✅ | ✅ |
| State logic (hook) | ✅ | - | - | - |
| State + UI | ✅ | - | ✅ | ✅ |
| API endpoint | ✅ | ✅ | - | - |
| Full feature | ✅ | ✅ | ✅ | ✅ |
| Refactoring | ✅ Existing | ✅ Existing | ✅ Existing | - |

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
