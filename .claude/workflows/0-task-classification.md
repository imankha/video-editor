# Stage 0: Task Classification

## Purpose

Analyze task scope to determine which agents add value and which tests to run. Default to the full workflow; skip stages only with explicit justification.

---

## Classification Output

Before starting any task, produce this classification:

```
## Task Classification: T{id}

**Stack Layers:** [Frontend | Backend | Modal | Database]
**Files Affected:** ~{n} files
**LOC Estimate:** ~{n} lines
**Test Scope:** [Frontend Unit | Frontend E2E | Backend | None]

### Agent Workflow
| Agent | Include | Justification |
|-------|---------|---------------|
| Code Expert | Yes/No | {reason} |
| Architect | Yes/No | {reason} |
| Tester | Yes/No | {reason} |
| Reviewer | Yes/No | {reason} |

### Skipped Stages
{List any skipped stages with justification, or "None - full workflow"}
```

---

## Stack Layer Definitions

| Layer | Scope | Test Commands |
|-------|-------|---------------|
| **Frontend** | React components, hooks, stores, styles | `cd src/frontend && npm test` (unit), `npm run test:e2e` (E2E) |
| **Backend** | FastAPI routes, services, models | `cd src/backend && pytest tests/ -v` |
| **Modal** | GPU functions, cloud processing | Backend tests + manual Modal verification |
| **Database** | Schema changes, migrations | Backend tests + migration verification |

### Common Layer Combinations

| Combination | Typical Scope | Test Scope |
|-------------|---------------|------------|
| Frontend only | UI changes, state, components | Frontend unit + E2E |
| Backend only | API endpoints, data processing | Backend only |
| Frontend + Backend | Feature with API integration | All tests |
| Backend + Modal | GPU pipeline changes | Backend + Modal logs |
| Full stack | End-to-end feature | All tests |

---

## Agent Inclusion Criteria

### Code Expert

**Include when:**
- Unfamiliar area of codebase
- 3+ files affected
- Cross-layer changes
- Need to understand existing patterns

**Skip when:**
- Single file change in familiar area
- Exact same pattern exists elsewhere (can reference directly)
- Pure styling/copy changes

### Architect

**Include when:**
- New patterns or abstractions needed
- State management changes
- API contract changes
- 5+ files affected
- Uncertainty about approach

**Skip when:**
- Implementation approach is obvious
- Following existing pattern exactly
- No new abstractions needed
- Single-layer, localized change

### Tester

**Include when:**
- Behavior changes (always)
- New functionality (always)
- Bug fixes (write regression test)

**Skip when:**
- Pure styling changes (colors, spacing)
- Copy/text changes only
- No behavior change

### Reviewer

**Include when:**
- Architect was included (verify design adherence)
- 5+ files changed
- Complex logic introduced

**Skip when:**
- Trivial changes
- No architectural decisions made

---

## Test Scope Selection

The Tester agent should run only tests relevant to affected layers:

| Affected Layers | Tests to Run |
|-----------------|--------------|
| Frontend only | Frontend unit tests for changed files, relevant E2E |
| Backend only | Backend tests for changed modules |
| Frontend + Backend | Frontend unit + E2E + Backend integration |
| Modal changes | Backend tests + Modal function verification |
| Database schema | Backend tests + migration verification |

### Test Selection Commands

```bash
# Frontend - specific test files
cd src/frontend && npm test -- src/hooks/useOverlay.test.js

# Frontend - E2E specific specs
cd src/frontend && npm run test:e2e -- tests/overlay.spec.js

# Backend - specific test modules
cd src/backend && pytest tests/test_clips.py tests/test_exports.py -v

# Backend - tests matching pattern
cd src/backend && pytest -k "overlay" -v
```

---

## Scope-Based Workflow Selection

### Minimal Scope (1-2 files, <20 LOC, single layer)

```
Files: 1-2 | LOC: <20 | Layers: 1
```

**Default workflow:**
1. Classification (this stage)
2. Implementation
3. Targeted tests (affected layer only)
4. Manual verification
5. Commit

**Agent inclusion:**
- Code Expert: Skip (small scope)
- Architect: Skip (no design decisions)
- Tester: Include if behavior changes
- Reviewer: Skip

### Moderate Scope (3-5 files, 20-100 LOC, 1-2 layers)

```
Files: 3-5 | LOC: 20-100 | Layers: 1-2
```

**Default workflow:**
1. Classification
2. Code Expert (quick audit of affected files)
3. Implementation
4. Targeted tests
5. Manual verification
6. Commit

**Agent inclusion:**
- Code Expert: Include (understand context)
- Architect: Skip unless new patterns needed
- Tester: Include
- Reviewer: Optional

### Large Scope (6+ files, 100+ LOC, or 3+ layers)

```
Files: 6+ | LOC: 100+ | Layers: 3+
```

**Default workflow (full):**
1. Classification
2. Code Expert (thorough audit)
3. Architect (design doc, approval gate)
4. Test First (failing tests)
5. Implementation
6. Review (verify design adherence)
7. Automated Testing
8. Manual Testing (approval gate)
9. Commit

**Agent inclusion:**
- All agents included
- Consider breaking into smaller tasks

---

## Classification Examples

| Task | Layers | Files | LOC | Agents | Test Scope |
|------|--------|-------|-----|--------|------------|
| Fix button color | Frontend | 1 | 5 | None | None (no behavior) |
| Add tooltip | Frontend | 1 | 15 | Tester | Frontend unit |
| Fix overlay keyframe delete | Frontend | 2-3 | 30 | Code Expert, Tester | Frontend unit + E2E |
| Add API endpoint | Backend | 2-3 | 50 | Code Expert, Tester | Backend |
| Multi-clip overlay bug | Frontend + Backend | 4-6 | 80 | All except Architect | Frontend + Backend |
| New export format | Full stack | 8+ | 200+ | All | All |

---

## Quick Reference

### Must Always Do
- Classify before starting
- Create branch (except <10 LOC single-file)
- Commit with co-author
- Update PLAN.md to TESTING

### Must Justify Skipping
- Code Expert (scope < 3 files AND familiar area)
- Architect (no new patterns AND obvious approach)
- Tester (no behavior change)
- Reviewer (Architect was skipped AND < 5 files)

### Never Skip
- Classification
- Implementation
- Final commit
- PLAN.md update
