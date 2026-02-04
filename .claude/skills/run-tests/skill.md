# Run Tests Skill

Run all tests for the video-editor project (frontend unit, backend unit, and E2E).

## Usage
Invoke with `/run-tests` or when the user asks to "run tests", "run all tests", or "check if tests pass".

## Instructions

### 1. Frontend Unit Tests
Run the Vitest unit tests:
```bash
cd src/frontend && npm test
```
Expected: ~349 tests pass across 15 test files.

### 2. Backend Unit Tests
**Important**: The backend uses a Python venv and requires explicit file globbing due to pytest discovery issues.

Run using the helper script:
```bash
cd src/backend && .venv/Scripts/python.exe run_tests.py
```

Or manually with:
```bash
cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_*.py -v --tb=short --capture=sys
```

Expected: ~314 tests pass across 18 test files (6 skipped - they need real video files).

### 3. E2E Tests (Playwright)
**Requires servers running first!**

#### Start servers (if not already running):
```bash
# Terminal 1 - Backend
cd src/backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000

# Terminal 2 - Frontend
cd src/frontend && npm run dev
```

#### Run E2E tests:
```bash
cd src/frontend && npm run test:e2e
```

#### E2E test options:
```bash
npm run test:e2e -- --ui          # Interactive UI mode (recommended for debugging)
npm run test:e2e -- --grep @smoke # Fast smoke tests only
npm run test:e2e -- --grep @full  # Full coverage tests
```

#### Re-running only failing tests:
When tests fail, re-run ONLY the specific failing tests until they pass, then run the full suite:

```bash
# Run specific test by file:line
npm run test:e2e -- regression-tests.spec.js:1128

# Run multiple specific tests by line number
npm run test:e2e -- regression-tests.spec.js:1128 regression-tests.spec.js:1170

# Run by exact test name (use quotes for spaces)
npm run test:e2e -- --grep "Framing: video first frame loads"
```

**Workflow:**
1. Run full suite → note failures
2. Re-run ONLY failing tests by file:line until all pass
3. Run full suite again to confirm no regressions

Expected: ~21+ tests pass. Tests in `e2e/` directory:
- `full-workflow.spec.js` - Complete user workflow tests
- `game-loading.spec.js` - Game/video loading tests
- `regression-tests.spec.js` - Regression prevention tests

### Key Details
- Frontend unit tests: Vitest with jsdom environment
- Backend venv: `src/backend/.venv`
- Backend pytest: Use `--capture=sys` to avoid closed file handle issues
- E2E tests: Playwright, requires ports 5173 (frontend) and 8000 (backend)
- E2E test data: Located at `../../formal annotations/12.6.carlsbad` relative to frontend

### Checking if servers are running:
```bash
curl -s http://localhost:8000/api/health  # Backend
curl -s http://localhost:5173             # Frontend
```

## Success Criteria
- Frontend unit: ~349 tests pass
- Backend unit: ~314 tests pass (6 skipped OK)
- E2E: ~21+ tests pass (some may fail if UI behavior changed)
