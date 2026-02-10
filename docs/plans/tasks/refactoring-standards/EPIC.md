# Refactoring to Standards Epic

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Scan the entire codebase for violations of our skill-defined standards, rate them by importance, and refactor in priority order.

## Standards (from Skills)

| Skill | Key Rules to Check |
|-------|-------------------|
| **type-safety** | No magic strings - use enums/constants |
| **data-always-ready** | Parent guards, children assume data exists |
| **mvc-pattern** | Screen → Container → View separation |
| **state-management** | Single store ownership, no duplicate state |
| **gesture-based-sync** | Actions not blobs for API updates |
| **api-guidelines** | Parameterized queries, R2 for storage |
| **bug-reproduction** | Tests for bug fixes |

---

## Rating Methodology

Rate each violation 1-5 based on **impact** and **change frequency**:

### Impact Score (how often is this code run?)

| Score | Criteria |
|-------|----------|
| 5 | Critical path - runs on every user action |
| 4 | Common path - runs frequently (page loads, saves) |
| 3 | Regular path - runs sometimes (exports, imports) |
| 2 | Rare path - runs occasionally (settings, edge cases) |
| 1 | Dead/nearly dead code |

### Churn Score (how often is this file modified?)

```bash
# Get file modification frequency (last 6 months)
git log --since="6 months ago" --name-only --pretty=format: | \
  sort | uniq -c | sort -rn | head -30
```

| Score | Criteria |
|-------|----------|
| 5 | Modified 10+ times in last 6 months |
| 4 | Modified 5-9 times |
| 3 | Modified 2-4 times |
| 2 | Modified once |
| 1 | Not modified in 6 months |

### Priority Formula

```
Priority = Impact × Churn
```

| Priority | Range | Action |
|----------|-------|--------|
| HIGH | 15-25 | Refactor immediately |
| MEDIUM | 8-14 | Refactor soon |
| LOW | 1-7 | Refactor when touching file |

---

## Scanning Process

### Phase 1: Automated Scans

#### Magic Strings Detection
```bash
# Find string comparisons that might be magic strings
grep -rn "== ['\"]" src/ --include="*.py" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx"
grep -rn "=== ['\"]" src/ --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx"
```

#### Duplicate State Detection
```bash
# Find state that might be duplicated across stores
grep -rn "useState\|create(" src/frontend/src/stores/ --include="*.js"
# Look for same field names across multiple stores
```

#### Data Guards in Children (violation)
```bash
# Find null checks inside components (should be in parent)
grep -rn "if.*!.*return.*null\|if.*===.*null\|if.*===.*undefined" src/frontend/src/components/
```

### Phase 2: Manual Review

For each file with violations:
1. Count violations
2. Assess impact (how often is this code run?)
3. Check git history for churn
4. Calculate priority
5. Create task if priority >= MEDIUM

---

## Scan Tasks (COMPLETE)

| ID | Task | Status | Findings |
|----|------|--------|----------|
| T300 | [Scan: Magic Strings](T300-scan-magic-strings.md) | DONE | 242 JS, ~50 Python violations |
| T310 | [Scan: Duplicate State](T310-scan-duplicate-state.md) | DONE | 2 critical duplicates found |
| T320 | [Scan: Data Guards](T320-scan-data-guards.md) | DONE | No critical violations |
| T330 | [Scan: MVC Violations](T330-scan-mvc-violations.md) | DONE | 2 significant violations |

## Refactor Tasks (by Priority)

| ID | Task | Priority | Source | Status |
|----|------|----------|--------|--------|
| T301 | Refactor editorMode to EDITOR_MODES constant | 25 | T300 | DONE |
| T311 | Remove workingVideo from overlayStore | 25 | T310 | DONE |
| T312 | Remove clipMetadata from overlayStore | 25 | T310 | TODO |
| T331 | Refactor ExportButton - extract logic to container | 25 | T330 | TODO |
| T302 | Refactor statusFilter/segment.status to constants | 16 | T300 | TODO |
| T303 | Refactor keyframe origin to KEYFRAME_ORIGINS | 16 | T300 | TODO |
| T332 | Refactor ProjectManager - receive data from screen | 16 | T330 | TODO |
| T313 | Investigate clips duplication in stores | 15 | T310 | TODO |
| T304 | Create EffectType enum (Python) | 12 | T300 | TODO |
| T305 | Create ExportMode enum (Python) | 9 | T300 | TODO |

---

## Completion Criteria

- [ ] All skills have been scanned for violations
- [ ] Violations rated and prioritized
- [ ] HIGH priority violations refactored
- [ ] MEDIUM priority violations have tasks created
- [ ] LOW priority noted for opportunistic fixes

---

## Output Format

After scanning, create a violations report:

```markdown
## Violations Report - {Date}

### HIGH Priority (refactor now)

| File | Violation | Impact | Churn | Priority |
|------|-----------|--------|-------|----------|
| overlayStore.js | Magic strings for effect types | 5 | 5 | 25 |
| ClipEditor.jsx | Data guard in child | 4 | 4 | 16 |

### MEDIUM Priority (refactor soon)

| File | Violation | Impact | Churn | Priority |
|------|-----------|--------|-------|----------|
| settings.py | Magic strings for status | 3 | 3 | 9 |

### LOW Priority (opportunistic)

| File | Violation | Impact | Churn | Priority |
|------|-----------|--------|-------|----------|
| legacy_export.py | Magic strings | 2 | 1 | 2 |
```
