# T4530: Editor-Mode Isolation Test Harness

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [editor-decoupling](EPIC.md) · Audit item G4 · **Runs LAST in the epic** (needs T4480/T4490's decoupling)

## Problem

[DEP] Today Overlay cannot be tested without Framing having written store state first (working video signal, clipMetadata) — mode tests must choreograph sibling-mode setup, so they either don't exist or test the choreography instead of the mode. The dependence-minimization directive: isolated work is testable work.

## Solution

1. **Per-mode fixture entry points:** for each editor mode (Annotate, Framing, Overlay), a test helper that mounts the mode's Screen with ONLY store fixtures (a seeded Zustand state + mocked API routes) — no sibling screen mounted, no cross-screen signal required. Deliverable: `src/frontend/src/test-utils/mountMode.js` (or match existing test-utils layout) + one smoke test per mode proving load-to-interactive.
2. **Isolation regression guard:** a test (or lint rule extension on T4290) asserting the timing-contract table in [EPIC.md](EPIC.md) stays empty — e.g., grep-based checks that `overlayStore` fields aren't written from `screens/FramingScreen.jsx`, that OverlayScreen mounts without `clipMetadata`. Cheap and blunt beats absent.
3. **Document the pattern** in the frontend testing docs/skill so new modes (and the T4460 migration) build on the harness instead of re-inventing setup.

## Context

- Files: new test-utils + per-mode smoke specs; read existing unit-test setup (`src/frontend/src/**/__tests__`, vitest config) and the e2e helpers first — reuse their mocking approach (MSW? fetch stubs? — match what exists).
- The store fixtures should be built from REAL API response shapes (capture from dev via the drive-app-as-user flow once, check in as JSON fixtures) — hand-written shapes drift.
- If T4480/T4490 left any signal alive, this task will fail honestly — that's it doing its job; finish the decoupling rather than special-casing the harness.

## Steps

1. [ ] Capture real API fixtures for one project (clips, overlay-data, working video) from dev.
2. [ ] `mountMode` helper + Overlay smoke test (the historically-coupled one) — it passing IS the epic's proof.
3. [ ] Annotate + Framing smoke tests.
4. [ ] Isolation regression checks + docs/skill update (same-PR rule from T4300).

## Acceptance Criteria

- [ ] Each mode mounts to interactive in a test with no sibling-mode involvement
- [ ] Fixtures are captured real shapes, checked in, with a regeneration note
- [ ] A regression check fails if a cross-screen store signal is reintroduced
- [ ] Pattern documented where the next implementor will find it
