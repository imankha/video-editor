# T320: Scan for Data Guard Violations

**Status:** DONE (scan complete)
**Impact:** MEDIUM
**Complexity:** LOW
**Created:** 2026-02-06
**Updated:** 2026-02-06

## Scan Results

### Summary

Found 20+ `return null` statements in components. Most are legitimate (modals checking `isOpen`), but some may be data guard violations.

### Legitimate Uses (NOT violations)

These are correct - checking if modal/panel should render:

```javascript
// Modal visibility checks - CORRECT
if (!isOpen) return null;  // ClipLibraryModal, GameDetailsModal, etc.

// Conditional rendering - CORRECT
if (isConnected === true) return null;  // ConnectionStatus
if (items.length === 0) return null;    // Empty state
```

### Potential Violations (need investigation)

#### 1. ProjectHeader.jsx:15
```javascript
if (!selectedProject) return null;
```
**Question:** Should parent guard this instead of child checking?

#### 2. ExportButton.jsx:102
```javascript
if (!clips || clips.length === 0) return null;
```
**Question:** Should parent ensure clips exist before rendering ExportButton?

#### 3. DownloadsPanel.jsx:48
```javascript
if (!ratingCounts) return null;
```
**Question:** Nested component - is this the right place for guard?

### Analysis

Most `return null` statements are for:
1. **Modal visibility** (`!isOpen`) - Correct pattern
2. **Empty state handling** (`length === 0`) - Correct pattern
3. **Conditional features** - Usually correct

The "Data Always Ready" principle primarily applies to **data props passed to components**, not visibility/conditional logic.

### True Violations Found

**None critical** - The codebase generally follows good patterns for data guards.

### Recommendations

1. **ProjectHeader**: Consider having parent guard `selectedProject`
2. **ExportButton**: Consider having parent ensure clips exist
3. **Document pattern**: Add to skill that modal `!isOpen` checks are fine

## Refactor Tasks to Create

| ID | Task | Priority |
|----|------|----------|
| - | No critical violations found | - |

## Progress Log

**2026-02-06**: Scan complete. Found 20+ return null statements, but most are legitimate modal visibility checks or empty state handling. No critical data guard violations found. The codebase generally follows good practices here.
