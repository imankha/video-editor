# Stage 0: Task Classification

## Purpose

Determine the appropriate workflow based on task complexity. Not every task needs the full 7-stage process.

## Classification Matrix

| Complexity | Criteria | Workflow |
|------------|----------|----------|
| **Trivial** | Single file, < 10 lines, no state changes | Direct → Test → Done |
| **Simple** | 1-3 files, follows existing patterns | Skip Architecture |
| **Standard** | Multiple files, new patterns, state changes | Full 7-stage |
| **Complex** | Cross-cutting, major refactoring, new systems | Full + Extra Review |

---

## How to Classify

### Trivial Tasks
**Skip to**: Direct implementation → Manual test → Done

**Examples**:
- Fix typo in UI text
- Change color/spacing
- Update static content
- Add/remove CSS class

**Criteria** (ALL must be true):
- [ ] Single file change
- [ ] Less than 10 lines modified
- [ ] No state changes
- [ ] No new dependencies
- [ ] Pattern already exists in codebase

**Workflow**:
```
1. Make the change
2. Verify it works (manual check)
3. Commit and done
```

---

### Simple Tasks
**Skip to**: Stage 3 (Test First) - skip Architecture

**Examples**:
- Add button that calls existing handler
- Move component to different location
- Add prop to existing component
- Simple refactor within one file

**Criteria** (ALL must be true):
- [ ] 1-3 files modified
- [ ] Follows existing patterns (no new architecture)
- [ ] No new state management
- [ ] Clear, unambiguous requirements

**Workflow**:
```
1. Task Start (Code Expert - quick audit)
2. Test First (if testable)
3. Implementation
4. Automated Testing
5. Manual Testing
6. Task Complete
```

---

### Standard Tasks
**Use**: Full 7-stage workflow

**Examples**:
- New feature with UI + state
- Modify existing feature behavior
- Add new API endpoint
- Integrate new library

**Criteria** (ANY true):
- [ ] 4+ files modified
- [ ] New state management needed
- [ ] New patterns introduced
- [ ] Multiple components affected
- [ ] Backend + frontend changes

**Workflow**: Full 7 stages
```
1. Task Start (Code Expert)
2. Architecture (Architect) - APPROVAL GATE
3. Test First (Tester)
4. Implementation (Implementor)
5. Automated Testing (Tester)
6. Manual Testing - APPROVAL GATE
7. Task Complete
```

---

### Complex Tasks
**Use**: Full workflow + additional review

**Examples**:
- Major refactoring across codebase
- New subsystem or module
- Database schema changes
- Breaking API changes
- Performance optimization

**Criteria** (ANY true):
- [ ] Touches 10+ files
- [ ] Changes core architecture
- [ ] Requires migration
- [ ] Affects multiple features
- [ ] High risk of regression

**Workflow**: Full 7 stages + extras
```
1. Task Start (Code Expert - thorough)
2. Architecture (Architect) - APPROVAL GATE
   → Consider breaking into smaller tasks
3. Test First (Tester - comprehensive)
4. Implementation (Implementor)
4.5 Review (Reviewer) - verify against design
5. Automated Testing (Tester)
6. Manual Testing - APPROVAL GATE
   → Extended testing period
7. Task Complete
```

---

## Quick Decision Tree

```
Start
  │
  ├─ Single file, < 10 lines, no state? → TRIVIAL
  │
  ├─ 1-3 files, existing patterns? → SIMPLE
  │
  ├─ New patterns OR state OR 4+ files? → STANDARD
  │
  └─ 10+ files OR core changes OR migrations? → COMPLEX
```

---

## Classification Examples

| Task | Classification | Reason |
|------|---------------|--------|
| "Fix button color" | Trivial | Single CSS change |
| "Add tooltip to icon" | Trivial | Single component, existing pattern |
| "Move toggle to layer icon" (T06) | Simple | 2 files, existing state |
| "Add progress bar to export" | Standard | New UI + state + WebSocket |
| "Refactor all exports to use unified interface" | Complex | Cross-cutting, many files |

---

## After Classification

| Complexity | Next Step |
|------------|-----------|
| Trivial | Just do it, then commit |
| Simple | Go to [1-task-start.md](1-task-start.md), skip Architecture |
| Standard | Go to [1-task-start.md](1-task-start.md), full workflow |
| Complex | Go to [1-task-start.md](1-task-start.md), consider splitting first |
